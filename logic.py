"""Kin behavior rules.

This module is pure: no Hermes imports, no clock, no network. The desktop
bundle keeps the same rules in desktop/src/logic.js. tests/cases.json runs
against both.
"""

from __future__ import annotations

import copy
import json
import re

MOOD_LINE = {
    "idle": "Here.",
    "thinking": "Thinking.",
    "attentive": "Listening.",
    "watching": "Watching the tool.",
    "concerned": "That did not work.",
    "pleased": "Done.",
    "dozing": "Resting.",
}

DEFAULT_SETTINGS = {
    "mute": False,
    "sleep": False,
    "quiet_start": "",
    "quiet_end": "",
    "long_task_ms": 180_000,
    "away_ms": 600_000,
    "speak_gap_ms": 600_000,
    "doze_ms": 180_000,
}

_TIME = re.compile(r"^(\d{2}):(\d{2})$")
_MS_KEYS = ("long_task_ms", "away_ms", "speak_gap_ms", "doze_ms")


def fresh_state(settings=None):
    merged = dict(DEFAULT_SETTINGS)
    if settings:
        merged.update(_clean_settings(settings))
    return {
        "settings": merged,
        "mood": "idle",
        "line": MOOD_LINE["idle"],
        "pinned": False,
        "draft": None,
        "streaming": False,
        "hidden": False,
        "busy_since": None,
        "away_since": None,
        "last_activity_at": None,
        "last_spoke_at": None,
        "streak": [],
        "loop_spoken": False,
        "away_notes": [],
        "last_tool": None,
        "progress": None,
    }


def safe_call(fn, **kwargs):
    """Run a hook body. A crash or a slow caller is the host's problem;
    we still refuse to raise, so Hermes logs and skips us before the 30s cap.
    """
    try:
        return fn(**kwargs)
    except Exception:
        return None


def as_bool(value):
    if isinstance(value, str):
        return value.strip().lower() in {"1", "true", "yes", "on"}
    return bool(value)


def _clean_settings(raw):
    cleaned = {}
    for key in DEFAULT_SETTINGS:
        if key not in raw:
            continue
        value = raw[key]
        if key in ("mute", "sleep"):
            cleaned[key] = as_bool(value)
        elif key in _MS_KEYS:
            try:
                cleaned[key] = int(value)
            except (TypeError, ValueError):
                continue
        elif key in ("quiet_start", "quiet_end"):
            cleaned[key] = value if isinstance(value, str) else ""
    return cleaned


def args_key(args):
    if args is None:
        return ""
    if isinstance(args, str):
        text = args.strip()
        if not text:
            return ""
        parsed = _parse_maybe(text)
        if isinstance(parsed, (dict, list)):
            return args_key(parsed)
        return " ".join(text.split())[:500]
    if isinstance(args, dict):
        return json.dumps(args, sort_keys=True, default=str, separators=(",", ":"))[:500]
    if isinstance(args, list):
        return json.dumps(args, default=str, separators=(",", ":"))[:500]
    return " ".join(str(args).split())[:500]


def _parse_maybe(value):
    if not isinstance(value, str):
        return value
    text = value.strip()
    if not text or text[0] not in "{[":
        return value
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return value


def clip(value, limit=180):
    return " ".join(str(value or "").split())[:limit]


def tool_failed(result=None, result_text=None, error=None):
    """Decide failure from fields the gateway actually sends.

    Current ToolCompletePayload has result, result_text, and summary.
    It does not declare an error field. An error string is honored only
    when a payload happens to carry one.
    """
    if isinstance(error, str) and error.strip():
        return True, clip(error)
    parsed = _parse_maybe(result)
    if isinstance(parsed, dict):
        if parsed.get("success") is False or parsed.get("is_error") is True:
            detail = parsed.get("error") or result_text or "tool failed"
            return True, clip(detail)
        err = parsed.get("error")
        if isinstance(err, str) and err.strip():
            return True, clip(err)
        code = parsed.get("exit_code", parsed.get("returncode"))
        if isinstance(code, int) and code != 0:
            return True, clip(result_text or "exit %s" % code)
    elif isinstance(parsed, str) and result_text is None:
        result_text = parsed
    text = result_text if isinstance(result_text, str) else ""
    stripped = text.strip()
    if stripped.startswith("Error") or "Traceback (most recent call last)" in stripped:
        return True, clip(stripped)
    return False, clip(stripped)


def parse_minute(value):
    if not isinstance(value, str):
        return None
    match = _TIME.match(value.strip())
    if not match:
        return None
    hour, minute = int(match.group(1)), int(match.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour * 60 + minute


def in_quiet(minute_of_day, start, end):
    start_min = parse_minute(start)
    end_min = parse_minute(end)
    if start_min is None or end_min is None or start_min == end_min:
        return False
    if not isinstance(minute_of_day, int):
        return False
    minute = minute_of_day % 1440
    if start_min < end_min:
        return start_min <= minute < end_min
    return minute >= start_min or minute < end_min


def explain(message):
    text = clip(message, 280)
    low = text.lower()
    if "timed out" in low or "timeout" in low:
        plain, fix = "The request timed out.", "Wait a moment and try that request once."
    elif any(token in low for token in ("401", "403", "unauthorized", "invalid api key", "forbidden")):
        plain, fix = "The provider refused the credentials.", "Check the sign-in for this model, then try again."
    elif "429" in low or "rate limit" in low:
        plain, fix = "The provider is rate limiting.", "Pause, then send again."
    elif any(token in low for token in ("500", "502", "503", "bad gateway")):
        plain, fix = "The provider failed on its side.", "Try the request one more time."
    elif "traceback" in low or "syntaxerror" in low or "exception" in low:
        plain, fix = "The code raised an exception.", "Read the first error line and change that one spot."
    elif "assert" in low or ("test" in low and "fail" in low):
        plain, fix = "A check failed.", "Change the code or the test, and do not repeat the same command."
    else:
        plain, fix = "That step failed.", "Read the first error line, change one thing, and try again."
    line = "%s %s" % (plain, fix)
    draft = "The last step failed. %s %s Do not repeat the same call." % (plain, fix)
    return line, draft


def can_speak(state, now_ms, minute_of_day, blocking=False):
    settings = state["settings"]
    if settings.get("mute") or settings.get("sleep"):
        return False
    if in_quiet(minute_of_day, settings.get("quiet_start", ""), settings.get("quiet_end", "")):
        return False
    if state.get("streaming") and not blocking:
        return False
    last = state.get("last_spoke_at")
    gap = settings.get("speak_gap_ms", 600_000)
    if last is not None and now_ms - last < gap:
        return False
    return True


def _speak(state, effects, now_ms, minute_of_day, text, tone="info", notify=False, blocking=False):
    if not can_speak(state, now_ms, minute_of_day, blocking=blocking):
        return False
    state["last_spoke_at"] = now_ms
    effects.append(
        {
            "kind": "speak",
            "text": text[:120],
            "tone": tone,
            "notify": bool(notify and state.get("hidden")),
        }
    )
    return True


def _pin(state, mood, line, draft=None):
    state["mood"] = mood
    state["line"] = line
    state["pinned"] = True
    state["draft"] = draft


def _mood(state, mood, line=None):
    if state.get("pinned") and state.get("mood") == "concerned":
        return
    state["mood"] = mood
    if not state.get("pinned"):
        state["line"] = line or MOOD_LINE[mood]


def _watching_line(state):
    name = state.get("last_tool") or "the tool"
    percent = state.get("progress")
    if isinstance(percent, (int, float)) and not isinstance(percent, bool):
        return "Watching %s. %d%%." % (name, int(percent))
    return "Watching %s." % name


def recap(notes):
    finished = sum(1 for note in notes if note.get("ok"))
    failed = sum(1 for note in notes if not note.get("ok"))
    first = "Welcome back. %d finished and %d failed while you were away." % (finished, failed)
    second = "One of those needs you." if failed else "Nothing is waiting on you."
    return "%s %s" % (first, second)


def reduce(state, event, now_ms, minute_of_day):
    current = copy.deepcopy(state)
    effects = []
    kind = event.get("type")
    settings = current["settings"]

    if kind == "settings":
        settings.update(_clean_settings(event))
        if settings.get("sleep"):
            _pin(current, "dozing", "Asleep.")
            current["draft"] = None
        elif current.get("line") == "Asleep.":
            current["pinned"] = False
            current["draft"] = None
            _mood(current, "idle")
        return current, effects

    if settings.get("sleep"):
        if kind == "blur":
            current["hidden"] = True
            if current.get("away_since") is None:
                current["away_since"] = now_ms
        elif kind == "focus":
            current["hidden"] = False
            current["away_since"] = None
            current["away_notes"] = []
        _pin(current, "dozing", "Asleep.")
        current["draft"] = None
        return current, effects

    if kind == "blur":
        current["hidden"] = True
        if current.get("away_since") is None:
            current["away_since"] = now_ms
        return current, effects

    if kind == "focus":
        away_for = None
        if current.get("away_since") is not None:
            away_for = now_ms - current["away_since"]
        notes = list(current.get("away_notes") or [])
        current["hidden"] = False
        current["away_since"] = None
        current["away_notes"] = []
        current["last_activity_at"] = now_ms
        if away_for is not None and away_for >= settings["away_ms"] and notes:
            line = recap(notes)
            _pin(current, "attentive", line)
            _speak(current, effects, now_ms, minute_of_day, line, tone="info")
        return current, effects

    if kind == "tick":
        if current.get("busy_since") is None and not current.get("streaming") and not current.get("pinned"):
            last = current.get("last_activity_at")
            if last is not None and now_ms - last >= settings["doze_ms"]:
                _mood(current, "dozing")
        return current, effects

    if kind in {
        "message_start",
        "message_delta",
        "message_complete",
        "tool_start",
        "tool_progress",
        "tool_complete",
        "gateway_error",
        "needs_you",
    }:
        current["last_activity_at"] = now_ms

    if kind == "message_start":
        current["streaming"] = False
        current["busy_since"] = now_ms
        current["streak"] = []
        current["loop_spoken"] = False
        current["progress"] = None
        current["pinned"] = False
        current["draft"] = None
        _mood(current, "thinking")
        return current, effects

    if kind == "message_delta":
        current["streaming"] = True
        _mood(current, "attentive")
        return current, effects

    if kind == "tool_start":
        current["streaming"] = False
        current["last_tool"] = str(event.get("name") or "tool")
        current["progress"] = None
        _mood(current, "watching", _watching_line(current))
        return current, effects

    if kind == "tool_progress":
        current["streaming"] = False
        if event.get("name"):
            current["last_tool"] = str(event["name"])
        percent = event.get("percent")
        if isinstance(percent, (int, float)) and not isinstance(percent, bool):
            current["progress"] = max(0, min(100, percent))
        _mood(current, "watching", _watching_line(current))
        return current, effects

    if kind == "tool_complete":
        current["streaming"] = False
        name = str(event.get("name") or current.get("last_tool") or "tool")
        key = str(event.get("args_key") or "")
        failed = bool(event.get("failed"))
        current["last_tool"] = name
        current["progress"] = None
        if current.get("hidden"):
            current["away_notes"].append({"kind": "tool", "name": name, "ok": not failed})
        if failed:
            current["streak"].append({"tool": name, "key": key})
            same = [item for item in current["streak"] if item["tool"] == name and item["key"] == key]
            if len(same) >= 3 and not current.get("loop_spoken"):
                current["loop_spoken"] = True
                line = "Same step failed 3 times. A different approach is ready."
                draft = {
                    "label": "Draft a different approach",
                    "text": (
                        "The same tool failed three times with the same arguments. "
                        "Stop repeating that call. Suggest one different approach and try that."
                    ),
                }
                _pin(current, "concerned", line, draft)
                _speak(
                    current,
                    effects,
                    now_ms,
                    minute_of_day,
                    "Same step failed 3 times. Want a different approach?",
                    tone="error",
                    notify=True,
                    blocking=True,
                )
            else:
                _mood(current, "concerned")
        else:
            current["streak"] = [
                item for item in current["streak"] if not (item["tool"] == name and item["key"] == key)
            ]
            _mood(current, "watching", _watching_line(current))
        return current, effects

    if kind == "message_complete":
        current["streaming"] = False
        status = event.get("status") or "complete"
        error = event.get("error") or ""
        busy_since = current.get("busy_since")
        long = busy_since is not None and now_ms - busy_since >= settings["long_task_ms"]
        current["busy_since"] = None
        ok = status != "error" and not (isinstance(error, str) and error.strip() and status != "interrupted")
        if current.get("hidden"):
            current["away_notes"].append({"kind": "turn", "ok": ok})
        if status == "interrupted":
            current["pinned"] = False
            current["draft"] = None
            _mood(current, "idle")
            return current, effects
        if status == "error" or (isinstance(error, str) and error.strip()):
            line, draft_text = explain(error or "The turn failed.")
            _pin(current, "concerned", line, {"label": "Draft a fix", "text": draft_text})
            spoken = "The long task failed." if long else line
            _speak(
                current,
                effects,
                now_ms,
                minute_of_day,
                spoken,
                tone="error",
                notify=long,
            )
            return current, effects
        if long:
            line = "The long task finished."
            _pin(current, "pleased", line)
            _speak(current, effects, now_ms, minute_of_day, line, tone="info", notify=True)
        else:
            current["pinned"] = False
            current["draft"] = None
            _mood(current, "pleased")
        return current, effects

    if kind == "gateway_error":
        message = event.get("message") or "The turn failed."
        if current.get("hidden"):
            current["away_notes"].append({"kind": "error", "ok": False})
        line, draft_text = explain(message)
        _pin(current, "concerned", line, {"label": "Draft a fix", "text": draft_text})
        _speak(current, effects, now_ms, minute_of_day, line, tone="error", notify=True)
        return current, effects

    if kind == "needs_you":
        _mood(current, "attentive", "Waiting on you.")
        return current, effects

    return current, effects
