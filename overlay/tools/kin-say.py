#!/usr/bin/env python3
"""kin-say.py — speak a line as a Kin character (persona voice + delivery style).

Usage:
  kin-say.py <avatarId> ["text to say"]   # prints the mp3 path on success
  kin-say.py --list                       # list characters

Generates TTS through the OpenAI-audio gateway (gpt-4o-mini-tts) using the
same voice + instructions the Kin overlay uses (mirrors AVATAR_VOICES in
main.js — keep the two in sync when adding characters). Output lands in
~/.hermes/cache/scratch/. Send it as a Telegram voice bubble with
[[audio_as_voice]] after the MEDIA: path.
"""
import sys
import os
import json
import time
import urllib.request

# Mirror of main.js AVATAR_VOICES (id -> voice / role / instructions / greet).
CHARACTERS = {
    "kin": {"voice": "shimmer", "instructions": "Warm friendly AI companion.", "greet": "Kin online. Watching your desktop."},
    "elena": {"voice": "sage", "instructions": "Arcane archivist: scholarly, precise, calm.", "greet": "Elena here. Archives and logs are open."},
    "vance": {"voice": "echo", "instructions": "Spec-ops operator: clipped, tactical, cool.", "greet": "Vance on comms. Tactical feed active."},
    "kael": {"voice": "onyx", "instructions": "Battle commander: firm, commanding, decisive.", "greet": "Commander Kael here. Ready for orders."},
    "sera": {"voice": "coral", "instructions": "Neural architect: bright, technical, precise.", "greet": "Sera linked. Neural telemetry online."},
    "freya": {"voice": "nova", "instructions": "Northern valkyrie: strong, noble, protective.", "greet": "Freya standing by. Your shield is up."},
}

PORTRAIT_DIR = os.path.join(os.path.dirname(__file__), "..", "avatars", "persona-art")
PORTRAITS_2D = ["kin", "elena", "vance", "kael", "sera", "freya"]


def resolve_gateway():
    sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))
    from tools.tts_tool_openai import _resolve_openai_audio_client_config
    return _resolve_openai_audio_client_config()


def synth(character_id, text):
    meta = CHARACTERS[character_id]
    key, base, _ = resolve_gateway()
    payload = {
        "model": "gpt-4o-mini-tts",
        "voice": meta["voice"],
        "input": text,
        "instructions": meta["instructions"],
    }
    req = urllib.request.Request(
        base.rstrip("/") + "/audio/speech",
        data=json.dumps(payload).encode(),
        headers={"Authorization": "Bearer " + key, "Content-Type": "application/json"},
    )
    out = os.path.expanduser(f"~/.hermes/cache/scratch/kin-say-{character_id}-{int(time.time())}.mp3")
    with open(out, "wb") as f:
        f.write(urllib.request.urlopen(req, timeout=30).read())
    return out


def main():
    args = sys.argv[1:]
    if not args or args[0] == "--list":
        print(" ".join(sorted(CHARACTERS)))
        return 0
    character_id = args[0]
    if character_id not in CHARACTERS:
        print(f"unknown character: {character_id}", file=sys.stderr)
        return 1
    text = " ".join(args[1:]).strip() or CHARACTERS[character_id]["greet"]
    print(synth(character_id, text))
    return 0


if __name__ == "__main__":
    sys.exit(main())
