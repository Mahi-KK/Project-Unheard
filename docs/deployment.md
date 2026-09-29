# Deployment

## A. Windows desktop (primary deliverable)

```bash
npm install
python -m venv backend/.venv
backend/.venv/Scripts/python -m pip install -r backend/requirements.txt -r backend/requirements-dev.txt
npm run sidecar            # backend -> src-tauri/binaries/unheard-backend-x86_64-pc-windows-msvc.exe
npx tauri build            # Rust stable + MSVC Build Tools + WebView2 required
```

Outputs:

- `src-tauri/target/release/unheard.exe` — the application (sidecar copied next to it)
- `src-tauri/target/release/bundle/nsis/Unheard_0.1.0_x64-setup.exe` — per-user installer

Key for the installed app: create `%APPDATA%\Unheard\.env` with `GEMINI_API_KEY=...`. Logs: `%APPDATA%\Unheard\backend.log`. Local data: `%APPDATA%\Unheard\unheard.db`.

## B. Hosted prototype link (web build + Cloud Run)

The same React build runs in a browser against a hosted backend. This is how a judge-accessible link is produced; the desktop app remains the primary product.

### Backend → Cloud Run

```bash
gcloud run deploy unheard-api --source . --region asia-south1 \
  --set-env-vars GEMINI_MODEL=gemini-3.6-flash,UNHEARD_CORS_ORIGINS=https://<your-site>.web.app \
  --set-secrets GEMINI_API_KEY=gemini-api-key:latest \
  --allow-unauthenticated
```

(`Dockerfile` at repo root. For Vertex AI instead of a key: `GOOGLE_GENAI_USE_VERTEXAI=true`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_CLOUD_LOCATION`, and grant the service account `roles/aiplatform.user`.)

Note: Cloud Run's filesystem is ephemeral — captured signals and cache reset on restart. That is acceptable for a demo link; production uses Firestore/BigQuery (see architecture.md).

### Frontend → Firebase Hosting

```bash
VITE_API_BASE=https://unheard-api-xxxxx.a.run.app npm run build
firebase deploy --only hosting
```

(`firebase.json` included; set your project with `firebase use <project-id>`.)

## C. Production (documented target)

See `docs/architecture.md` §2: Cloud Run + Vertex AI + BigQuery + Firebase Auth/Firestore + Google Maps Platform, with the scoring job scheduled against BigQuery and grievance feeds via Pub/Sub.
