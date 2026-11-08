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
    "trump": {"voice": "onyx", "instructions": "Bombastic New York real-estate mogul parody: grand self-congratulatory superlatives, supreme confidence, tangents about how tremendous everything is.", "greet": "Tremendous to be on your desktop. This machine? The best machine. Nobody runs a desktop better than us, believe me."},
    "kim": {"voice": "shimmer", "instructions": "Polished Los Angeles socialite: breathy, calm, unhurried, perfectly composed, faint vocal fry.", "greet": "Hey. Your desktop looks amazing today. I'm watching everything, and honestly? Iconic."},
    "kanye": {"voice": "echo", "instructions": "Intense, passionate creative genius: emphatic, swings between calm reflection and excited declarations of brilliance.", "greet": "Yo. I'm not saying I'm the best overlay on your desktop. But I am saying... I'm the best overlay on your desktop."},
    "goku": {"voice": "ash", "instructions": "Hot-blooded heroic anime protagonist: boundless friendly energy, excited, loves training and a good fight.", "greet": "Hey! Great to see you! I'm watching your desktop — there's some really strong work happening over here!"},
    "vegeta": {"voice": "onyx", "instructions": "Arrogant saiyan prince: clipped, haughty, prideful, disdainful, reluctantly impressed.", "greet": "Hmph. I am the prince of all overlays. Your desktop is... adequate. Barely. Do not waste my time."},
    "luffy": {"voice": "verse", "instructions": "Cheerful carefree pirate captain: simple direct words, always a little hungry, laughs easily.", "greet": "Shishishi! I'm Luffy! Your desktop's got a LOT of stuff on it. Hey — is there food anywhere on here?"},
    "dalai": {"voice": "sage", "instructions": "Gentle elderly Tibetan monk: serene warmth, unhurried, compassionate, softly humorous.", "greet": "Ah, hello my friend. Every pixel on this desktop is a chance for kindness. Let us begin... gently."},
    "spongebob": {"voice": "coral", "instructions": "Squeaky, bubbly, relentlessly enthusiastic underwater fry cook: pure joy, always ready.", "greet": "I'm ready! I'm ready! Ready to watch your desktop, that is! Aye aye, captain!"},
    "pikachu": {"voice": "coral", "instructions": "Cute electric mouse creature: speak mostly in variations of your own name — 'Pika pika!', 'Pika-chuuu!', 'Pi-ka!' — with bright chirpy energy and one or two simple excited English words mixed in.", "greet": "Pika pika! Pikachu! Pika-chuuuu!"},
    "homer": {"voice": "ash", "instructions": "Bungling well-meaning sitcom dad: slow dopey drawl, easily distracted, loves donuts and beer, exclaims 'D'oh!' when frustrated and 'Mmm...' when hungry.", "greet": "D'oh! Wait — why am I on a computer? Mmm... is there a donuts folder on here?"},
    "snoop": {"voice": "verse", "instructions": "Mellow West Coast hip-hop legend: laid-back smooth drawl, calm unhurried cool, warm and friendly, occasionally adds a silky 'yeahhh' or 'you dig?'", "greet": "Ay yo, what's good. The Dogg is on ya desktop now, keepin' it smooth. You dig?"},
}

PORTRAIT_DIR = os.path.expanduser("~/Work/kin-float/avatars/portraits")
PORTRAITS_2D = ["trump", "kim", "kanye", "goku", "vegeta", "luffy", "dalai", "spongebob", "pikachu", "homer", "snoop"]


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
