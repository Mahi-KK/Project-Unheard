"""Runtime configuration.

Secrets are read from the environment only. Lookup order for a .env file:
  1. real environment variables (always win)
  2. backend/.env               (local development)
  3. <repo>/.env                (local development)
  4. %APPDATA%/Unheard/.env     (installed desktop app)
Nothing secret is ever sent to the frontend.
"""
from __future__ import annotations

import os
import sys
from dataclasses import dataclass, field
from functools import lru_cache
from pathlib import Path

from dotenv import load_dotenv


def _bundle_root() -> Path:
    # PyInstaller one-file bundles unpack to sys._MEIPASS
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        return Path(sys._MEIPASS)  # type: ignore[attr-defined]
    return Path(__file__).resolve().parents[2]  # repo root


def app_data_dir() -> Path:
    base = os.environ.get("APPDATA") or str(Path.home() / ".config")
    p = Path(base) / "Unheard"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _load_env_files() -> None:
    root = _bundle_root()
    for candidate in (root / "backend" / ".env", root / ".env", app_data_dir() / ".env"):
        if candidate.exists():
            load_dotenv(candidate, override=False)


DEFAULT_CORS = [
    "http://localhost:1420",
    "http://127.0.0.1:1420",
    "tauri://localhost",
    "http://tauri.localhost",
    "https://tauri.localhost",
]


@dataclass(frozen=True)
class Settings:
    gemini_api_key: str | None
    gemini_model: str
    gemini_embed_model: str
    gemini_timeout_s: float
    gemini_max_retries: int
    data_path: Path
    db_path: Path
    fonts_dir: Path
    cors_origins: list[str] = field(default_factory=list)
    api_token: str | None = None
    use_vertex: bool = False
    gemini_fallback_models: list[str] = field(default_factory=list)
    gemini_total_budget_s: float = 40.0
    gemini_concurrency: int = 2

    @property
    def gemini_configured(self) -> bool:
        return bool(self.gemini_api_key) or self.use_vertex

    @property
    def gemini_backend(self) -> str:
        return "vertex-ai" if self.use_vertex and not self.gemini_api_key else "gemini-api"


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    _load_env_files()
    root = _bundle_root()
    cors = os.environ.get("UNHEARD_CORS_ORIGINS")
    return Settings(
        gemini_api_key=(os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY") or None),
        gemini_model=os.environ.get("GEMINI_MODEL", "gemini-3.6-flash"),
        gemini_embed_model=os.environ.get("GEMINI_EMBED_MODEL", "gemini-embedding-001"),
        gemini_timeout_s=float(os.environ.get("GEMINI_TIMEOUT_S", "25")),
        gemini_max_retries=int(os.environ.get("GEMINI_MAX_RETRIES", "2")),
        gemini_fallback_models=[m.strip() for m in os.environ.get("GEMINI_FALLBACK_MODELS", "gemini-3.5-flash,gemini-3.1-flash-lite").split(",") if m.strip()],
        gemini_total_budget_s=float(os.environ.get("GEMINI_TOTAL_BUDGET_S", "40")),
        gemini_concurrency=int(os.environ.get("GEMINI_CONCURRENCY", "2")),
        data_path=Path(os.environ.get("UNHEARD_DATA_PATH", root / "data" / "processed" / "districts.json")),
        db_path=Path(os.environ.get("UNHEARD_DB_PATH", app_data_dir() / "unheard.db")),
        fonts_dir=root / "backend" / "app" / "assets" / "fonts",
        cors_origins=[o.strip() for o in cors.split(",")] if cors else DEFAULT_CORS,
        api_token=os.environ.get("UNHEARD_API_TOKEN") or None,
        use_vertex=os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true", "yes"),
    )
