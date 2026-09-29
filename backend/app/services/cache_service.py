"""Local SQLite store for the prototype runtime.

Holds (a) citizen signals captured in this app and (b) validated Gemini
responses keyed by a hash of model + task + input. This is a local
prototype store — production uses BigQuery / Firestore (docs/architecture.md).
"""
from __future__ import annotations

import hashlib
import json
import sqlite3
import threading
import time
import uuid
from pathlib import Path
from typing import Any

_SCHEMA = """
CREATE TABLE IF NOT EXISTS signals (
  id TEXT PRIMARY KEY,
  created_at REAL NOT NULL,
  district_id TEXT NOT NULL,
  category TEXT NOT NULL,
  source TEXT NOT NULL,
  language TEXT,
  transcript TEXT NOT NULL,
  normalized_request TEXT,
  summary TEXT,
  urgency REAL,
  analysis_json TEXT,
  duplicate_of TEXT
);
CREATE INDEX IF NOT EXISTS signals_district ON signals(district_id);
CREATE TABLE IF NOT EXISTS gemini_cache (
  key TEXT PRIMARY KEY,
  task TEXT NOT NULL,
  model TEXT NOT NULL,
  created_at REAL NOT NULL,
  response_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS embeddings (
  key TEXT PRIMARY KEY,
  model TEXT NOT NULL,
  vector_json TEXT NOT NULL
);
"""


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.row_factory = sqlite3.Row
        self._db.executescript(_SCHEMA)
        self._db.commit()

    # ------------------------------------------------------------ signals
    def add_signal(self, s: dict[str, Any]) -> dict[str, Any]:
        row = {
            "id": f"cap-{uuid.uuid4().hex[:12]}",
            "created_at": time.time(),
            "district_id": s["district_id"],
            "category": s["category"],
            "source": s["source"],
            "language": s.get("language"),
            "transcript": s["transcript"],
            "normalized_request": s.get("normalized_request"),
            "summary": s.get("summary"),
            "urgency": s.get("urgency"),
            "analysis_json": json.dumps(s.get("analysis")) if s.get("analysis") else None,
            "duplicate_of": s.get("duplicate_of"),
        }
        with self._lock:
            self._db.execute(
                "INSERT INTO signals VALUES (:id,:created_at,:district_id,:category,:source,:language,:transcript,:normalized_request,:summary,:urgency,:analysis_json,:duplicate_of)",
                row,
            )
            self._db.commit()
        return self._public(row)

    def list_signals(self, district_id: str | None = None) -> list[dict[str, Any]]:
        with self._lock:
            if district_id:
                cur = self._db.execute("SELECT * FROM signals WHERE district_id=? ORDER BY created_at DESC", (district_id,))
            else:
                cur = self._db.execute("SELECT * FROM signals ORDER BY created_at DESC")
            return [self._public(dict(r)) for r in cur.fetchall()]

    def delete_signal(self, signal_id: str) -> bool:
        with self._lock:
            cur = self._db.execute("DELETE FROM signals WHERE id=?", (signal_id,))
            self._db.commit()
            return cur.rowcount > 0

    def clear_signals(self, source: str | None = None) -> int:
        with self._lock:
            cur = self._db.execute("DELETE FROM signals WHERE source=?", (source,)) if source else self._db.execute("DELETE FROM signals")
            self._db.commit()
            return cur.rowcount

    @staticmethod
    def _public(row: dict[str, Any]) -> dict[str, Any]:
        out = dict(row)
        aj = out.pop("analysis_json", None)
        out["analysis"] = json.loads(aj) if aj else None
        out["synthetic"] = False
        return out

    # ------------------------------------------------------------ gemini cache
    @staticmethod
    def cache_key(task: str, model: str, payload: Any) -> str:
        blob = json.dumps({"task": task, "model": model, "payload": payload}, sort_keys=True, ensure_ascii=False)
        return hashlib.sha256(blob.encode()).hexdigest()

    def cache_get(self, key: str) -> Any | None:
        with self._lock:
            r = self._db.execute("SELECT response_json FROM gemini_cache WHERE key=?", (key,)).fetchone()
        return json.loads(r["response_json"]) if r else None

    def cache_put(self, key: str, task: str, model: str, response: Any) -> None:
        with self._lock:
            self._db.execute(
                "INSERT OR REPLACE INTO gemini_cache VALUES (?,?,?,?,?)",
                (key, task, model, time.time(), json.dumps(response, ensure_ascii=False)),
            )
            self._db.commit()

    # ------------------------------------------------------------ embeddings
    def emb_get(self, key: str) -> list[float] | None:
        with self._lock:
            r = self._db.execute("SELECT vector_json FROM embeddings WHERE key=?", (key,)).fetchone()
        return json.loads(r["vector_json"]) if r else None

    def emb_put(self, key: str, model: str, vec: list[float]) -> None:
        with self._lock:
            self._db.execute("INSERT OR REPLACE INTO embeddings VALUES (?,?,?)", (key, model, json.dumps(vec)))
            self._db.commit()
