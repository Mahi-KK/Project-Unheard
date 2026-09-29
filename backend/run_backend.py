"""Entry point for the desktop sidecar and local development.

    python run_backend.py --port 8765
"""
from __future__ import annotations

import argparse
import os
import sys


def _ensure_streams() -> None:
    # A windowed (no-console) PyInstaller build has no stdout/stderr; send logs
    # to %APPDATA%/Unheard/backend.log instead of crashing the logger.
    if sys.stdout is None or sys.stderr is None:
        from app.config import app_data_dir

        log = open(app_data_dir() / "backend.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = sys.stdout or log
        sys.stderr = sys.stderr or log


def main() -> None:
    parser = argparse.ArgumentParser(description="UNHEARD backend")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=int(os.environ.get("UNHEARD_PORT", "8765")))
    args = parser.parse_args()
    _ensure_streams()

    import uvicorn

    from app.main import app

    uvicorn.run(app, host=args.host, port=args.port, log_level="info", access_log=False, log_config=None)


if __name__ == "__main__":
    main()
