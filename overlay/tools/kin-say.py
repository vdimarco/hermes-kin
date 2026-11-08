#!/usr/bin/env python3
"""kin-say.py — speak a line as a Kin character (delivery style per character).

Usage:
  kin-say.py <avatarId> ["text to say"]   # prints the audio file path on success
  kin-say.py --list                       # list characters

Speaks through Hermes's own text_to_speech tool (the published
``tools.registry`` API), so Hermes picks the provider and holds its key; this
script never reads a credential. It uses Hermes's current TTS voice plus the
character's delivery instructions (mirrors AVATAR_VOICES in main.js — keep
the two in sync when adding characters). Send the result as a Telegram voice
bubble with [[audio_as_voice]] after the MEDIA: path.
"""
import sys
import os
import json

# Mirror of main.js AVATAR_VOICES (id -> voice / role / instructions / greet).
CHARACTERS = {
    "kin": {"voice": "shimmer", "instructions": "Warm friendly AI companion.", "greet": "Kin online. Watching your desktop."},
    "elena": {"voice": "sage", "instructions": "Arcane archivist: scholarly, precise, calm.", "greet": "Elena here. Archives and logs are open."},
    "vance": {"voice": "echo", "instructions": "Spec-ops operator: clipped, tactical, cool.", "greet": "Vance on comms. Tactical feed active."},
    "kael": {"voice": "onyx", "instructions": "Battle commander: firm, commanding, decisive.", "greet": "Commander Kael here. Ready for orders."},
    "sera": {"voice": "coral", "instructions": "Neural architect: bright, technical, precise.", "greet": "Sera linked. Neural telemetry online."},
    "freya": {"voice": "nova", "instructions": "Northern valkyrie: strong, noble, protective.", "greet": "Freya standing by. Your shield is up."},
    # Cartoon personas (2D portraits).
    "zip": {"voice": "verse", "instructions": "Cheerful little robot sidekick: bright, quick, upbeat.", "greet": "Zip online. Your builds are in good hands."},
    "juno": {"voice": "alloy", "instructions": "Confident focus coach: warm, direct, encouraging.", "greet": "Juno here. Let's get you unstuck."},
    "sprout": {"voice": "fable", "instructions": "Excited baby dragon: curious, bouncy, eager.", "greet": "Sprout's awake! What are we building?"},
    "ollie": {"voice": "ash", "instructions": "Jolly octopus ship captain: hearty, playful.", "greet": "Captain Ollie. All tasks on deck."},
    "barley": {"voice": "ballad", "instructions": "Calm bear: slow, warm, steady.", "greet": "Barley here. Coffee's on. Take your time."},
    "mochi": {"voice": "shimmer", "instructions": "Sleepy soft creature: gentle, hushed, soothing.", "greet": "Mochi's on watch. Rest easy."},
    "moss": {"voice": "onyx", "instructions": "Laid-back sloth: slow, mellow, unbothered, a little amused.", "greet": "Moss here. No rush. We'll get there."},
}

PORTRAIT_DIR = os.path.join(os.path.dirname(__file__), "..", "avatars", "persona-art")
PORTRAITS_2D = ["kin", "elena", "vance", "kael", "sera", "freya"]


def synth(character_id, text):
    sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))
    from tools.registry import discover_builtin_tools, registry

    if registry.get_entry("text_to_speech") is None:
        discover_builtin_tools()
    meta = CHARACTERS[character_id]
    raw = registry.dispatch("text_to_speech", {"text": text, "instructions": meta["instructions"]})
    data = json.loads(raw) if isinstance(raw, str) else (raw or {})
    if not data.get("success") or not data.get("file_path"):
        raise RuntimeError(str(data.get("error") or "speech failed"))
    return str(data["file_path"])


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
