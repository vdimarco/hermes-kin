#!/usr/bin/env python3
"""Render docs/cast-scroll.gif: a looping carousel that slides one cast card
at a time (3D busts, then 2D toons) and holds each card centred for 1.5s.

Styling follows cast.html / cast-toons.html (palette, card chrome, accent
colours, roles). Fraunces / Inter / JetBrains Mono aren't installed locally,
so the closest fc-match picks are used: Noto Serif, Noto Sans, JetBrains Mono.

Usage: python3 docs/promo-src/cast-scroll.py
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

HERE = Path(__file__).resolve().parent
OUT = HERE.parent / "cast-scroll.gif"

# name, file, kind, accent, role, greeting, chip key, chip value
CAST = [
    ("Kin",    "busts/kin.png",    "3D", "#ffb86b", "Companion",         "Kin online. Watching your desktop.",       "voice", "shimmer"),
    ("Elena",  "busts/elena.png",  "3D", "#76d69a", "Arcane archivist",  "Elena here. Archives and logs are open.",  "voice", "sage"),
    ("Freya",  "busts/freya.png",  "3D", "#a9cbff", "Northern valkyrie", "Freya standing by. Your shield is up.",    "voice", "nova"),
    ("Kael",   "busts/kael.png",   "3D", "#ffd05a", "Battle commander",  "Commander Kael here. Ready for orders.",   "voice", "onyx"),
    ("Sera",   "busts/sera.png",   "3D", "#bf94ff", "Neural architect",  "Sera linked. Neural telemetry online.",    "voice", "coral"),
    ("Vance",  "busts/vance.png",  "3D", "#5fd4ff", "Spec-ops operator", "Vance on comms. Tactical feed active.",    "voice", "echo"),
    ("Zip",    "toons/zip.png",    "2D", "#5fe3d0", "Systems sidekick",  "Zip online. Your builds are in good hands.", "mood", "upbeat"),
    ("Juno",   "toons/juno.png",   "2D", "#ffc94a", "Focus coach",       "Juno here. Let’s get you unstuck.",        "mood", "direct"),
    ("Sprout", "toons/sprout.png", "2D", "#8fe08a", "Curious helper",    "Sprout’s awake! What are we building?",    "mood", "eager"),
    ("Ollie",  "toons/ollie.png",  "2D", "#ff8a5c", "Queue captain",     "Captain Ollie. All tasks on deck.",        "mood", "jolly"),
    ("Barley", "toons/barley.png", "2D", "#e0645a", "Calm keeper",       "Barley here. Coffee’s on. Take your time.", "mood", "steady"),
    ("Mochi",  "toons/mochi.png",  "2D", "#f4a8d0", "Quiet-hours guard", "Mochi’s on watch. Rest easy.",            "mood", "sleepy"),
    ("Moss",   "toons/moss.png",   "2D", "#7fcfb8", "Chill navigator",   "Moss here. No rush. We’ll get there.",     "mood", "mellow"),
]

FONTS = Path("/usr/share/fonts")
SERIF_BOLD = FONTS / "noto/NotoSerif-Bold.ttf"
SERIF_SEMI = FONTS / "noto/NotoSerif-SemiBold.ttf"
SERIF_ITAL = FONTS / "noto/NotoSerif-MediumItalic.ttf"
SANS_SEMI = FONTS / "noto/NotoSans-SemiBold.ttf"
SANS_REG = FONTS / "noto/NotoSans-Regular.ttf"
MONO = FONTS / "TTF/JetBrainsMonoNerdFont-Regular.ttf"

W, H = 880, 520          # GIF size
DW, DH = 300, 470        # card design size (layout units below)
CW, CH = 260, 407        # card size in the GIF
# Neighbours only peek in at the edges: every visible card costs ~30 KB per
# frame, so showing ~1 card at a time is what keeps the GIF under 5 MB.
GAP = 270
PITCH = CW + GAP
CARD_Y = 90
SS = 2                   # supersampling for card rendering
HOLD_MS = 1500
SLIDE_FRAMES = 5         # 6 eased steps x 83ms = 0.5s slide (~12fps)
SLIDE_MS = 83

BG_TOP, BG_BOT = (15, 18, 34), (10, 12, 21)
INK = (243, 239, 230)
MUTED = (169, 173, 191)


def font(path, size):
    p = Path(path)
    if not p.exists():  # SemiBold isn't always shipped; fall back to Bold
        p = SERIF_BOLD if "Serif" in p.name else FONTS / "noto/NotoSans-Bold.ttf"
    return ImageFont.truetype(str(p), size)


def hex_rgb(h):
    return tuple(int(h[i:i + 2], 16) for i in (1, 3, 5))


def radial(size, center, radii, rgb, alpha):
    """Elliptical radial glow, alpha falling to 0 at 72% of the radius."""
    w, h = size
    g = Image.new("L", (256, 256), 0)
    gd = ImageDraw.Draw(g)
    for i in range(128, 0, -1):
        t = i / 128
        a = 0 if t > 0.72 else int(alpha * 255 * (1 - t / 0.72) ** 1.3)
        gd.ellipse((128 - i, 128 - i, 128 + i, 128 + i), fill=a)
    rx, ry = radii
    g = g.resize((2 * rx, 2 * ry), Image.BILINEAR)
    mask = Image.new("L", size, 0)
    mask.paste(g, (center[0] - rx, center[1] - ry))
    layer = Image.new("RGBA", size, rgb + (0,))
    layer.putalpha(mask)
    return layer


def background():
    bg = Image.new("RGB", (W, H))
    d = ImageDraw.Draw(bg)
    # gradient only behind the header; a solid stage under the cards keeps the
    # 256-colour palette from contouring it into visible bands
    for y in range(H):
        t = min(1.0, y / CARD_Y)
        d.line([(0, y), (W, y)], fill=tuple(round(a + (b - a) * t) for a, b in zip(BG_TOP, BG_BOT)))
    bg = bg.convert("RGBA")
    bg.alpha_composite(radial((W, H), (W // 2, -30), (460, 220), (255, 184, 107), 0.16))
    d = ImageDraw.Draw(bg)
    d.text((40, 24), "Pick your", font=font(SERIF_BOLD, 36), fill=INK)
    x = 40 + d.textlength("Pick your ", font=font(SERIF_BOLD, 36))
    d.text((x, 24), "avatar.", font=font(SERIF_ITAL, 36), fill=(255, 201, 143))
    sub = font(SANS_REG, 14)
    for i, line in enumerate(("Six 3D characters and seven 2D toons.", "Click the Avatar pill to switch.")):
        d.text((W - 40, 32 + i * 21), line, font=sub, fill=MUTED, anchor="ra")
    return bg


def wrap(draw, text, fnt, width):
    lines, cur = [], ""
    for word in text.split():
        trial = f"{cur} {word}".strip()
        if draw.textlength(trial, font=fnt) <= width or not cur:
            cur = trial
        else:
            lines.append(cur)
            cur = word
    return lines + [cur]


def card(entry):
    name, src, kind, accent, role, greet, chip_k, chip_v = entry
    a = hex_rgb(accent)
    s = SS
    w, h = DW * s, DH * s
    face_h = 300 * s
    r = 20 * s

    shape = Image.new("L", (w, h), 0)
    ImageDraw.Draw(shape).rounded_rectangle((0, 0, w - 1, h - 1), r, fill=255)

    c = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    # card fill: rgba(255,255,255,.05) -> .02 gradient over the stage
    fill = Image.new("RGBA", (w, h))
    fd = ImageDraw.Draw(fill)
    for y in range(h):
        t = y / (h - 1)
        fd.line([(0, y), (w, y)], fill=(255, 255, 255, round(255 * (0.05 - 0.03 * t))))
    c.alpha_composite(fill)
    c.alpha_composite(radial((w, h), (w // 2, int(face_h * (0.42 if kind == "3D" else 0.55))),
                             (int(170 * s), int(190 * s)), a, 0.34))

    # art: transparent PNG, bottom faded out like the CSS mask
    art = Image.open(HERE / src).convert("RGBA")
    art_h = (300 if kind == "3D" else 270) * s
    if name == "Kin":
        art_h = 220 * s
    art_w = round(art.width * art_h / art.height)
    max_w = int(w * 1.0)
    if art_w > max_w:
        art_w, art_h = max_w, round(art.height * max_w / art.width)
    art = art.resize((art_w, art_h), Image.LANCZOS)
    fade = Image.new("L", (1, art_h))
    cut = int(art_h * 0.82)
    for y in range(art_h):
        fade.putpixel((0, y), 255 if y < cut else round(255 * (1 - (y - cut) / (art_h - cut))))
    fade = fade.resize((art_w, art_h))
    alpha = Image.composite(art.getchannel("A"), Image.new("L", art.size, 0), fade)
    art.putalpha(alpha)
    bottom = (24 if kind == "3D" else 6) * s
    if name == "Kin":
        bottom = 46 * s
    ax, ay = (w - art_w) // 2, face_h - bottom - art_h

    # floor shadow ellipse in the accent colour
    sh = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    ImageDraw.Draw(sh).ellipse((w * 0.2, face_h - 22 * s, w * 0.8, face_h - 8 * s), fill=a + (110,))
    c.alpha_composite(sh.filter(ImageFilter.GaussianBlur(7 * s)))
    face = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    face.paste(art, (ax, ay), art)
    face_clip = Image.new("L", (w, h), 0)
    ImageDraw.Draw(face_clip).rectangle((0, 0, w, face_h), fill=255)
    face.putalpha(Image.composite(face.getchannel("A"), Image.new("L", (w, h), 0), face_clip))
    c.alpha_composite(face)

    d = ImageDraw.Draw(c)
    px = 20 * s
    y = face_h + 6 * s
    d.text((px, y), role.upper(), font=font(SANS_SEMI, 11 * s), fill=a)
    y += 20 * s
    d.text((px, y), name, font=font(SERIF_SEMI, 38 * s), fill=INK)
    y += 54 * s
    gf = font(SERIF_ITAL, 15 * s)
    for line in wrap(d, f"“{greet}”", gf, w - 2 * px):
        d.text((px, y), line, font=gf, fill=(235, 229, 216))
        y += 21 * s

    # chip, pinned to the bottom like .chip{margin-top:auto}
    mf = font(MONO, 11 * s)
    key = f"{chip_k} "
    tw = d.textlength(key + chip_v, font=mf)
    cy = h - 20 * s - 24 * s
    d.rounded_rectangle((px, cy, px + tw + 18 * s, cy + 24 * s), 7 * s,
                        fill=(255, 255, 255, 16), outline=(255, 255, 255, 22), width=s)
    d.text((px + 9 * s, cy + 12 * s), key, font=mf, fill=(201, 204, 217), anchor="lm")
    d.text((px + 9 * s + d.textlength(key, font=mf), cy + 12 * s), chip_v, font=mf, fill=a, anchor="lm")

    # 3D / 2D badge, styled like the .default pill
    bf = font(SANS_SEMI, 12 * s)
    bw = d.textlength(kind, font=bf) + 20 * s
    bx, by = w - 14 * s - bw, 14 * s
    d.rounded_rectangle((bx, by, bx + bw, by + 24 * s), 12 * s, fill=a)
    d.text((bx + bw / 2, by + 12 * s), kind, font=bf, fill=(11, 13, 23), anchor="mm")

    # clip to the rounded card, then the 1px border
    c.putalpha(Image.composite(c.getchannel("A"), Image.new("L", (w, h), 0), shape))
    ImageDraw.Draw(c).rounded_rectangle((0, 0, w - 1, h - 1), r, outline=(255, 255, 255, 23), width=s)
    return c.resize((CW, CH), Image.LANCZOS)


def ease(t):
    return 4 * t ** 3 if t < 0.5 else 1 - (-2 * t + 2) ** 3 / 2


def frame(bg, cards, pos):
    """pos is the fractional index of the centred card; cards wrap around."""
    n = len(cards)
    im = bg.copy()
    x0 = (W - CW) / 2
    for k, c in enumerate(cards):
        off = (k - pos + n / 2) % n - n / 2
        x = round(x0 + off * PITCH)
        if x + CW < 0 or x > W:
            continue
        # side cards sit back a little so the centred one reads as selected
        dim = min(1.0, abs(off))
        tile = c
        if dim > 0:
            tile = c.copy()
            tile.putalpha(tile.getchannel("A").point(lambda v: round(v * (1 - 0.55 * dim))))
        im.alpha_composite(tile, (x, CARD_Y))
    return im.convert("RGB")


def soften(c):
    """Slide-frame variant: a light median filter on the art shaves LZW cost
    (motion hides it). Text and the badge stay sharp."""
    top, bottom = round(CH * 50 / DH), round(CH * 300 / DH)
    out = c.copy()
    art = c.crop((0, top, CW, bottom))
    rgb = art.convert("RGB").filter(ImageFilter.MedianFilter(3))
    rgb.putalpha(art.getchannel("A"))
    out.paste(rgb, (0, top))
    return out


def main():
    bg = background()
    cards = [card(e) for e in CAST]
    moving = [soften(c) for c in cards]
    n = len(cards)
    frames, durations = [], []
    for i in range(n):
        frames.append(frame(bg, cards, i))
        durations.append(HOLD_MS)
        for f in range(1, SLIDE_FRAMES + 1):
            frames.append(frame(bg, moving, i + ease(f / (SLIDE_FRAMES + 1))))
            durations.append(SLIDE_MS)

    # one shared 256-colour palette, sampled from every hold frame plus a few
    # slide frames per transition so the dimmed side cards map cleanly too
    step = SLIDE_FRAMES + 1
    picks = [i * step + k for i in range(n) for k in (0, 2, step // 2, step - 2)]
    sheet = Image.new("RGB", (W, H * len(picks)))
    for j, k in enumerate(picks):
        sheet.paste(frames[k], (0, H * j))
    # median cut starves the big near-black areas, so pin their exact colours:
    # the stage column and a column down the card's empty margin
    hold = frames[0]
    cx = (W - CW) // 2 + 6
    pinned = sorted({hold.getpixel((x, y)) for y in range(H) for x in (4, cx, W - cx - 1)})
    if len(pinned) > 48:
        pinned = pinned[:: -(-len(pinned) // 48)]
    auto = sheet.quantize(256 - len(pinned), method=Image.Quantize.MEDIANCUT)
    flat = auto.getpalette()[: 3 * (256 - len(pinned))] + [v for c in pinned for v in c]
    pal = Image.new("P", (1, 1))
    pal.putpalette(flat)
    q = [f.quantize(palette=pal, dither=Image.Dither.NONE) for f in frames]
    q[0].save(OUT, save_all=True, append_images=q[1:], duration=durations,
              loop=0, optimize=True, disposal=1)
    print(f"wrote {OUT} ({OUT.stat().st_size / 1e6:.2f} MB, {len(q)} frames)")


if __name__ == "__main__":
    main()
