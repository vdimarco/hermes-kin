"""Profile-scoped memory for Kin.

Hermes supplies the database inside a real install. Tests pass a file path
so nothing here touches the network or another plugin's files.
"""

from __future__ import annotations

import sqlite3
import threading
from pathlib import Path

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    session_id TEXT,
    kind TEXT NOT NULL,
    name TEXT,
    ok INTEGER NOT NULL,
    detail TEXT
);
CREATE TABLE IF NOT EXISTS notes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    consumed INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class Memory:
    def __init__(self, path=None):
        self._lock = threading.Lock()
        self._conn = self._open(path)
        self._conn.executescript(_SCHEMA)
        # Remove the unused credential left by older overlays.
        self._conn.execute("DELETE FROM settings WHERE key = 'elevenlabs_api_key'")
        self._conn.commit()

    def _open(self, path):
        if path is not None:
            conn = sqlite3.connect(str(path), check_same_thread=False)
        else:
            from plugins.plugin_storage import plugin_db

            conn = plugin_db("kin")
        conn.row_factory = sqlite3.Row
        return conn

    def add_event(self, ts, kind, ok, name="", detail="", session_id=""):
        detail = " ".join(str(detail or "").split())[:180]
        name = str(name or "")[:80]
        with self._lock:
            self._conn.execute(
                "INSERT INTO events (ts, session_id, kind, name, ok, detail) VALUES (?, ?, ?, ?, ?, ?)",
                (float(ts), str(session_id or ""), str(kind), name, 1 if ok else 0, detail),
            )
            self._conn.execute(
                "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 400)"
            )
            self._conn.commit()

    def add_note(self, ts, kind, text):
        body = str(text or "").strip()[:1500]
        if not body:
            return
        with self._lock:
            self._conn.execute(
                "INSERT INTO notes (ts, kind, text, consumed) VALUES (?, ?, ?, 0)",
                (float(ts), str(kind), body),
            )
            self._conn.commit()

    def consume_handoff(self):
        with self._lock:
            row = self._conn.execute(
                "SELECT id, text FROM notes WHERE kind = 'handoff' AND consumed = 0 ORDER BY id DESC LIMIT 1"
            ).fetchone()
            if row is None:
                return None
            self._conn.execute("UPDATE notes SET consumed = 1 WHERE id = ?", (row["id"],))
            self._conn.commit()
            return row["text"]

    def recent_events(self, limit=40):
        with self._lock:
            rows = self._conn.execute(
                "SELECT ts, session_id, kind, name, ok, detail FROM events ORDER BY id DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        return [
            {
                "ts": row["ts"],
                "session_id": row["session_id"],
                "kind": row["kind"],
                "name": row["name"],
                "ok": bool(row["ok"]),
                "detail": row["detail"],
            }
            for row in rows
        ]

    def recent_notes(self, limit=20):
        with self._lock:
            rows = self._conn.execute(
                "SELECT ts, kind, text, consumed FROM notes ORDER BY id DESC LIMIT ?",
                (int(limit),),
            ).fetchall()
        return [
            {
                "ts": row["ts"],
                "kind": row["kind"],
                "text": row["text"],
                "consumed": bool(row["consumed"]),
            }
            for row in rows
        ]

    def wipe(self):
        with self._lock:
            self._conn.execute("DELETE FROM events")
            self._conn.execute("DELETE FROM notes")
            self._conn.commit()

    def get_settings(self):
        with self._lock:
            rows = self._conn.execute("SELECT key, value FROM settings WHERE key != 'elevenlabs_api_key'").fetchall()
        return {row["key"]: row["value"] for row in rows}

    def update_settings(self, values):
        with self._lock:
            for key, value in values.items():
                if key == "elevenlabs_api_key":
                    continue
                self._conn.execute(
                    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
                    (str(key), "" if value is None else str(value)),
                )
            self._conn.commit()
        return self.get_settings()

    def close(self):
        self._conn.close()


def handoff_text(events):
    if not events:
        return "No recent tool activity was stored."
    lines = []
    for event in events[:12]:
        status = "ok" if event.get("ok") else "failed"
        name = event.get("name") or event.get("kind") or "event"
        detail = event.get("detail") or ""
        lines.append(("%s %s. %s" % (name, status, detail)).strip())
    return "Where we left off: " + " ".join(lines)
