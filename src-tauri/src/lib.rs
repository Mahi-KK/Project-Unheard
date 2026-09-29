//! UNHEARD desktop shell.
//!
//! On launch it starts the bundled FastAPI analysis engine
//! (`unheard-backend`, a PyInstaller sidecar) on a free loopback port with a
//! per-launch random token, and exposes `{base_url, token}` to the UI through
//! the `backend_info` command. The Gemini API key stays inside the backend
//! process; the UI never sees it.
//!
//! `UNHEARD_BACKEND_URL` overrides the sidecar (e.g. a Cloud Run deployment or
//! a local `uvicorn` during development).

use std::sync::Mutex;

use serde::Serialize;
use tauri::{Manager, RunEvent};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;

struct Backend {
    base_url: String,
    token: Option<String>,
    child: Mutex<Option<CommandChild>>,
}

#[derive(Serialize)]
struct BackendInfo {
    base_url: String,
    token: Option<String>,
}

#[tauri::command]
fn backend_info(state: tauri::State<'_, Backend>) -> BackendInfo {
    BackendInfo {
        base_url: state.base_url.clone(),
        token: state.token.clone(),
    }
}

/// Writes an exported PDF to the path the user picked in the save dialog.
/// Only `.pdf` files are accepted; content must start with the PDF magic bytes.
#[tauri::command]
fn write_pdf(path: String, bytes: Vec<u8>) -> Result<(), String> {
    let p = std::path::PathBuf::from(&path);
    let is_pdf = p
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("pdf"))
        .unwrap_or(false);
    if !is_pdf {
        return Err("Only .pdf files can be written.".into());
    }
    if !bytes.starts_with(b"%PDF") {
        return Err("Refusing to write: content is not a PDF.".into());
    }
    std::fs::write(&p, bytes).map_err(|e| e.to_string())
}

fn free_port() -> u16 {
    std::net::TcpListener::bind("127.0.0.1:0")
        .and_then(|l| l.local_addr())
        .map(|a| a.port())
        .unwrap_or(8765)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            if let Ok(url) = std::env::var("UNHEARD_BACKEND_URL") {
                app.manage(Backend {
                    base_url: url,
                    token: std::env::var("UNHEARD_API_TOKEN").ok(),
                    child: Mutex::new(None),
                });
                return Ok(());
            }

            let port = free_port();
            let token = uuid::Uuid::new_v4().simple().to_string();
            let spawned = app.shell().sidecar("unheard-backend").and_then(|cmd| {
                cmd.args(["--port", &port.to_string()])
                    .env("UNHEARD_API_TOKEN", &token)
                    .spawn()
            });

            match spawned {
                Ok((mut rx, child)) => {
                    tauri::async_runtime::spawn(async move {
                        while let Some(event) = rx.recv().await {
                            match event {
                                CommandEvent::Stdout(line) | CommandEvent::Stderr(line) => {
                                    println!("[backend] {}", String::from_utf8_lossy(&line).trim_end());
                                }
                                CommandEvent::Terminated(status) => {
                                    eprintln!("[backend] exited: {:?}", status.code);
                                }
                                _ => {}
                            }
                        }
                    });
                    app.manage(Backend {
                        base_url: format!("http://127.0.0.1:{port}"),
                        token: Some(token),
                        child: Mutex::new(Some(child)),
                    });
                }
                Err(err) => {
                    // The map, scores, dossier and simulator still work offline;
                    // the UI shows the engine as offline.
                    eprintln!("[backend] failed to start sidecar: {err}");
                    app.manage(Backend {
                        base_url: "http://127.0.0.1:8765".into(),
                        token: None,
                        child: Mutex::new(None),
                    });
                }
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![backend_info, write_pdf])
        .build(tauri::generate_context!())
        .expect("error while building UNHEARD");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(child) = handle.state::<Backend>().child.lock().ok().and_then(|mut c| c.take()) {
                let _ = child.kill();
            }
        }
    });
}
