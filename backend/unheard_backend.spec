# PyInstaller spec for the UNHEARD analysis engine (Tauri sidecar).
# Build:  powershell -File scripts/build_sidecar.ps1
# -*- mode: python ; coding: utf-8 -*-
from pathlib import Path

from PyInstaller.utils.hooks import collect_submodules

ROOT = Path(SPECPATH).parent  # repo root

datas = [
    (str(ROOT / "data" / "processed" / "districts.json"), "data/processed"),
    (str(ROOT / "backend" / "app" / "assets" / "fonts"), "backend/app/assets/fonts"),
]

hiddenimports = (
    collect_submodules("uvicorn")
    + collect_submodules("google.genai")
    + ["app.main"]
)

a = Analysis(
    [str(ROOT / "backend" / "run_backend.py")],
    pathex=[str(ROOT / "backend")],
    datas=datas,
    hiddenimports=hiddenimports,
    excludes=["tkinter", "pytest", "pymupdf", "fitz", "fontTools", "PyInstaller"],
    noarchive=False,
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="unheard-backend",
    console=False,
    upx=False,
    runtime_tmpdir=None,
)
