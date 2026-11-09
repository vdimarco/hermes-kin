import asyncio
import sqlite3
import tempfile
import unittest
from pathlib import Path

from memory import Memory
from dashboard import plugin_api


class CredentialRemovalTest(unittest.TestCase):
    def test_legacy_key_is_deleted_and_never_returned(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'data.db'
            with sqlite3.connect(path) as conn:
                conn.execute('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)')
                conn.executemany('INSERT INTO settings VALUES (?, ?)',
                                 [('elevenlabs_api_key', 'old-secret'), ('mute', 'true')])
            mem = Memory(path)
            previous = plugin_api._memory
            plugin_api._memory = mem
            try:
                with sqlite3.connect(path) as conn:
                    self.assertIsNone(conn.execute("SELECT value FROM settings WHERE key = 'elevenlabs_api_key'").fetchone())
                    # A still-running old overlay must not re-expose the credential.
                    conn.execute("INSERT INTO settings VALUES ('elevenlabs_api_key', 'old-overlay-secret')")
                self.assertEqual(asyncio.run(plugin_api.get_settings()), {'mute': 'true'})
                self.assertEqual(asyncio.run(plugin_api.memory())['settings'], {'mute': 'true'})
                self.assertEqual(mem.update_settings({'elevenlabs_api_key': 'new-secret'}), {'mute': 'true'})
            finally:
                plugin_api._memory = previous
                mem.close()
