# Builds the FastAPI backend into a single-file Windows executable and places
# it where Tauri expects the sidecar: src-tauri/binaries/unheard-backend-<target-triple>.exe
$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$py = Join-Path $root "backend\.venv\Scripts\python.exe"
if (-not (Test-Path $py)) {
  python -m venv backend\.venv
  & $py -m pip install -r backend\requirements.txt -r backend\requirements-dev.txt
}

$rustc = (Get-Command rustc -ErrorAction SilentlyContinue).Source
if (-not $rustc) { $rustc = Join-Path $env:USERPROFILE ".cargo\bin\rustc.exe" }
$triple = "x86_64-pc-windows-msvc"
if (Test-Path $rustc) {
  $hostLine = & $rustc -vV | Select-String "^host:"
  if ($hostLine) { $triple = $hostLine.ToString().Split(" ")[1] }
}

& $py -m PyInstaller --noconfirm --clean --distpath build\sidecar --workpath build\pyinstaller backend\unheard_backend.spec
if ($LASTEXITCODE -ne 0) { throw "PyInstaller failed" }

New-Item -ItemType Directory -Force src-tauri\binaries | Out-Null
Copy-Item build\sidecar\unheard-backend.exe "src-tauri\binaries\unheard-backend-$triple.exe" -Force
Write-Host "Sidecar ready: src-tauri\binaries\unheard-backend-$triple.exe"
