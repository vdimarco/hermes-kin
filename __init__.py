"""Kin companion plugin.

Hooks return immediately and never raise. Hermes skips a hook that exceeds
plugins.hook_callback_timeout (30 seconds). Kin does not use that budget.
"""

from __future__ import annotations

import logging
import json
import time

from .logic import as_bool, safe_call, tool_failed
from .memory import Memory, handoff_text

log = logging.getLogger(__name__)
_memory = None


def _mem():
    global _memory
    if _memory is None:
        _memory = Memory()
    return _memory


def _emit(event, payload):
    try:
        from hermes_cli.plugin_events import broadcast_plugin_event

        broadcast_plugin_event("kin", event, payload or {})
    except Exception:
        log.debug("kin broadcast skipped", exc_info=True)


def _settings():
    try:
        return _mem().get_settings()
    except Exception:
        return {}


def _post_tool(tool_name="", args=None, result="", **kwargs):
    failed, detail = tool_failed(result=result)
    _mem().add_event(
        time.time(),
        "tool",
        not failed,
        name=str(tool_name or ""),
        detail=detail,
        session_id=str(kwargs.get("session_id") or kwargs.get("task_id") or ""),
    )


import re as _re

_SPEECH_MAX = 280


def _speech_line(text, limit=_SPEECH_MAX):
    """Reduce an assistant reply to something that reads well aloud."""
    text = _re.sub(r"```.*?```", " Code section omitted. ", text, flags=_re.S)
    text = _re.sub(r"`[^`]*`", " ", text)
    text = _re.sub(r"MEDIA:\S+", " ", text)
    text = _re.sub(r"::preview\{[^}]*\}", " ", text)
    text = _re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = _re.sub(r"[*_#>\[\]{}|]", " ", text)
    text = _re.sub(r"\s+", " ", text).strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    idx = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return (cut[: idx + 1] if idx > limit // 3 else cut).strip()


def _post_llm(assistant_response="", **kwargs):
    """Speak chat replies through the persona: queue pending_say for the overlay."""
    text = str(assistant_response or "").strip()
    if not text:
        return
    s = _mem().get_settings()
    if as_bool(s.get("mute")) or as_bool(s.get("sleep")):
        return
    if not as_bool(s.get("speak_replies", True)):
        return
    line = _speech_line(text)
    if not line:
        return
    _mem().update_settings({"pending_say": json.dumps({"ts": time.time(), "text": line})})


def _api_error(error=None, status_code=None, **kwargs):
    message = ""
    if isinstance(error, dict):
        message = str(error.get("message") or error.get("type") or "")
    elif error:
        message = str(error)
    if status_code:
        message = ("%s %s" % (status_code, message)).strip()
    message = " ".join(message.split())[:280]
    _mem().add_event(time.time(), "api", False, name="api", detail=message, session_id=str(kwargs.get("session_id") or ""))
    _emit("api_error", {"message": message or "The provider request failed."})


def _session_start(session_id="", **kwargs):
    _mem().add_event(time.time(), "session", True, name="start", session_id=str(session_id or ""))


def _session_end(session_id="", **kwargs):
    _mem().add_event(time.time(), "session", True, name="end", session_id=str(session_id or ""))


def _pre_llm(is_first_turn=False, **kwargs):
    if not is_first_turn:
        return None
    settings = _settings()
    if as_bool(settings.get("mute")) or as_bool(settings.get("sleep")):
        return None
    note = _mem().consume_handoff()
    if not note:
        return None
    return {"context": "Kin left this note from the last session:\n" + note}


def _command(raw_args="", **kwargs):
    parts = (raw_args or "").strip().split()
    cmd = parts[0].lower() if parts else "status"
    rest = parts[1:]
    try:
        if cmd in {"", "status"}:
            return _status()
        if cmd == "mute":
            return _set_flag("mute", rest)
        if cmd == "sleep":
            return _set_flag("sleep", ["on"])
        if cmd == "wake":
            return _set_flag("sleep", ["off"])
        if cmd == "quiet":
            return _quiet(rest)
        if cmd == "memory":
            return _show_memory()
        if cmd == "wipe":
            _mem().wipe()
            return "Kin memory wiped."
        if cmd == "wrapup":
            return _wrapup()
        if cmd == "help":
            return _help()
        return _help()
    except Exception:
        log.debug("kin command failed", exc_info=True)
        return "Kin could not do that. Try /kin help."


def _help():
    return "\n".join(
        [
            "Kin commands:",
            "/kin status",
            "/kin mute on|off",
            "/kin sleep",
            "/kin wake",
            "/kin quiet 22:00 07:00",
            "/kin quiet off",
            "/kin memory",
            "/kin wipe",
            "/kin wrapup",
        ]
    )


def _status():
    settings = _settings()
    mute = "on" if as_bool(settings.get("mute")) else "off"
    sleep = "on" if as_bool(settings.get("sleep")) else "off"
    quiet = settings.get("quiet_start") or ""
    if quiet and settings.get("quiet_end"):
        quiet = "%s to %s" % (settings.get("quiet_start"), settings.get("quiet_end"))
    else:
        quiet = "off"
    events = _mem().recent_events(5)
    lines = ["Kin mute %s, sleep %s, quiet hours %s." % (mute, sleep, quiet)]
    if not events:
        lines.append("No stored events.")
    for event in events:
        lines.append("%s %s." % (event.get("name") or event.get("kind"), "ok" if event.get("ok") else "failed"))
    return "\n".join(lines)


def _set_flag(key, rest):
    current = as_bool(_settings().get(key))
    if not rest:
        value = not current
    elif rest[0].lower() in {"on", "true", "yes"}:
        value = True
    elif rest[0].lower() in {"off", "false", "no"}:
        value = False
    else:
        return "Use on or off."
    saved = _mem().update_settings({key: "true" if value else "false"})
    _emit("settings", saved)
    return "Kin %s %s." % (key, "on" if value else "off")


def _quiet(rest):
    if not rest or rest[0].lower() == "off":
        saved = _mem().update_settings({"quiet_start": "", "quiet_end": ""})
        _emit("settings", saved)
        return "Quiet hours off."
    if len(rest) < 2:
        return "Use /kin quiet 22:00 07:00 or /kin quiet off."
    saved = _mem().update_settings({"quiet_start": rest[0], "quiet_end": rest[1]})
    _emit("settings", saved)
    return "Quiet hours %s to %s." % (rest[0], rest[1])


def _show_memory():
    events = _mem().recent_events(15)
    notes = _mem().recent_notes(5)
    if not events and not notes:
        return "Kin has nothing stored."
    lines = []
    for note in notes:
        lines.append(note["text"])
    for event in events:
        detail = event.get("detail") or ""
        lines.append("%s %s. %s" % (event.get("name") or event.get("kind"), "ok" if event.get("ok") else "failed", detail).strip())
    return "\n".join(lines)


def _wrapup():
    text = handoff_text(_mem().recent_events(12))
    _mem().add_note(time.time(), "handoff", text)
    return text


def register(ctx):
    ctx.register_hook("post_tool_call", lambda **kwargs: safe_call(_post_tool, **kwargs))
    ctx.register_hook("api_request_error", lambda **kwargs: safe_call(_api_error, **kwargs))
    ctx.register_hook("on_session_start", lambda **kwargs: safe_call(_session_start, **kwargs))
    ctx.register_hook("on_session_end", lambda **kwargs: safe_call(_session_end, **kwargs))
    ctx.register_hook("pre_llm_call", lambda **kwargs: safe_call(_pre_llm, **kwargs))
    ctx.register_hook("post_llm_call", lambda **kwargs: safe_call(_post_llm, **kwargs))
    ctx.register_command("kin", _command, description="Kin companion controls", args_hint="status|mute|sleep|wake|quiet|memory|wipe|wrapup")
