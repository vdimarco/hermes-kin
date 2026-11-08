"""Local routes for the Kin desktop half. No outbound network."""

from __future__ import annotations

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
    updates = {}
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
    return {"prompt": prompt, "draft": draft, "voice_cmd": voice_cmd, "nav": nav}


@router.get("/memory")
async def memory():
    return {"events": _mem().recent_events(), "notes": _mem().recent_notes(), "settings": _mem().get_settings()}


@router.post("/memory/wipe")
async def wipe():
    _mem().wipe()
    return {"ok": True}
