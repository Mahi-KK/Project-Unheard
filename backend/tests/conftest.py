import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

# isolated DB + no key for every test run (tests must never call the real API)
os.environ["UNHEARD_DB_PATH"] = str(Path(tempfile.mkdtemp()) / "test.db")
os.environ["GEMINI_API_KEY"] = ""
os.environ.pop("GOOGLE_API_KEY", None)
os.environ.pop("GOOGLE_GENAI_USE_VERTEXAI", None)
