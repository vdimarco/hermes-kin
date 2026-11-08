"""Local routes for the Kin desktop half.

No outbound network of its own. Spoken lines go through Hermes's own
``text_to_speech`` tool (the published ``tools.registry`` API): Hermes picks
the provider and holds its key, and Kin only gets back an audio file path.
"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from fastapi import APIRouter

router = APIRouter()
_memory = None
_ROOT = Path(__file__).resolve().parent.parent


def _load_memory_class():
    import importlib.util

    path = _ROOT / "memory.py"
    spec = importlib.util.spec_from_file_location("kin_memory", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.Memory


def _mem():
    global _memory
    if _memory is None:
        _memory = _load_memory_class()()
    return _memory


_speech_latest = ""


def _synthesize(req):
    """Speak a line through Hermes's text_to_speech tool, chunk by chunk.

    Each finished chunk is listed in `speech_ready` right away, so the overlay
    plays chunk 1 while later chunks are still being made. A newer request
    stops an older one, so a stale line never overwrites a new one.
    """
    global _speech_latest
    rid = str(req.get("id") or "")
    _speech_latest = rid
    chunks = req.get("chunks")
    if not isinstance(chunks, list):
        chunks = [req.get("text")]
    chunks = [str(c).strip()[:600] for c in chunks if str(c or "").strip()][:12]
    instructions = str(req.get("instructions") or "").strip()[:300]
    state = {"id": rid, "items": [], "done": False, "error": ""}

    def publish():
        if _speech_latest == rid:
            _mem().update_settings({"speech_ready": json.dumps(state)})

    try:
        from tools.registry import discover_builtin_tools, registry

        if registry.get_entry("text_to_speech") is None:
            discover_builtin_tools()
        for i, chunk in enumerate(chunks):
            if _speech_latest != rid:
                return
            args = {"text": chunk}
            if instructions:
                args["instructions"] = instructions
            raw = registry.dispatch("text_to_speech", args)
            data = json.loads(raw) if isinstance(raw, str) else (raw or {})
            if not (data.get("success") and data.get("file_path")):
                state["error"] = str(data.get("error") or "speech failed")[:200]
                break
            state["items"].append({"i": i, "path": str(data["file_path"])})
            publish()
    except Exception as exc:
        state["error"] = type(exc).__name__
    state["done"] = True
    publish()


def _emit(event, payload):
    try:
        from hermes_cli.plugin_events import broadcast_plugin_event

        broadcast_plugin_event("kin", event, payload or {})
    except Exception:
        return


@router.get("/health")
async def health():
    return {"ok": True}


@router.get("/avatar")
async def avatar():
    return {"ok": True, "asset": "kin-bust.glb"}


@router.get("/settings")
async def get_settings():
    return _mem().get_settings()


@router.post("/settings")
async def save_settings(body: dict):
    allowed = (
        "mute", "sleep", "quiet_start", "quiet_end",
        "long_task_ms", "away_ms", "speak_gap_ms", "doze_ms",
        "mood", "line", "voice_active", "voice_mode",
    )
    payload = {key: body.get(key) for key in allowed if key in body}
    saved = _mem().update_settings(payload)
    _emit("settings", saved)
    return saved


@router.get("/outbox")
async def get_outbox():
    s = _mem().get_settings()
    prompt = s.get("pending_prompt") or ""
    draft = s.get("pending_draft") or ""
    voice_cmd = s.get("pending_voice_cmd") or ""
    nav = s.get("pending_nav") or ""
    speech = s.get("pending_speech") or ""
    updates = {}
    if speech:
        updates["pending_speech"] = ""
    if prompt:
        updates["pending_prompt"] = ""
    if draft:
        updates["pending_draft"] = ""
    if voice_cmd:
        updates["pending_voice_cmd"] = ""
    if nav:
        updates["pending_nav"] = ""
    if updates:
        _mem().update_settings(updates)
    if speech:
        # The overlay asked for a spoken line. Synthesis takes seconds, so it
        # runs off the event loop; the overlay picks up `speech_ready`.
        try:
            req = json.loads(speech)
        except ValueError:
            req = None
        if isinstance(req, dict) and (req.get("chunks") or str(req.get("text") or "").strip()):
            asyncio.get_running_loop().run_in_executor(None, _synthesize, req)
    return {"prompt": prompt, "draft": draft, "voice_cmd": voice_cmd, "nav": nav}


@router.get("/memory")
async def memory():
    return {"events": _mem().recent_events(), "notes": _mem().recent_notes(), "settings": _mem().get_settings()}


@router.post("/memory/wipe")
async def wipe():
    _mem().wipe()
    return {"ok": True}
