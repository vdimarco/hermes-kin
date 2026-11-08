// kin-2d.js — Kin portrait engine: layered generated character art.
// Each persona is a set of AI-illustrated portraits (base / eyes-closed /
// mouth-open) stacked as image layers and animated by one shared rig:
// blinking, audio-level lip-sync, cursor gaze parallax, mood posture, and an
// idle float. Pure DOM — no 3D, no WebGL, works the same on every platform.

const PDIR = "./avatars/persona-art/";
const PORTRAIT_IDS = ["kin", "elena", "vance", "kael", "sera", "freya"];
const portraitSrc = (id, kind) => `${PDIR}${id}${kind ? `-${kind}` : ""}.png`;

const MOOD_POSE = {
  idle: "",
  attentive: "scale(1.02)",
  watching: "",
  thinking: "translateY(-4px)",
  concerned: "rotate(-2.5deg) translateY(4px)",
  pleased: "scale(1.03)",
  dozing: "rotate(5deg) translateY(7px)",
};

export function mount2D(stageEl) {
  let holder = null;
  let wrap = null;
  let breathe = null;
  let imgBase = null;
  let imgBlink = null;
  let imgMouth = null;
  let charId = "";
  let mood = "idle";
  let gazeX = 0;
  let gazeY = 0;
  let talking = false;
  let speechLevel = 0;
  let blinking = false;
  let blinkTimer = 0;
  let mouthOpen = false;

  function applyPose() {
    if (!wrap) return;
    const gx = (gazeX || 0) * 14;
    const gy = (gazeY || 0) * 8;
    const rot = (gazeX || 0) * 2.2;
    const pose = MOOD_POSE[mood] || "";
    const base = `translate(${gx.toFixed(1)}px, ${gy.toFixed(1)}px) rotate(${rot.toFixed(2)}deg)`;
    wrap.style.transform = pose ? `${base} ${pose}` : base;
    const dozing = mood === "dozing";
    if (breathe) {
      breathe.style.animation = dozing ? "none" : "";
      breathe.style.filter = dozing ? "saturate(0.65) brightness(0.85)" : "";
    }
    if (imgBlink) imgBlink.style.opacity = dozing || blinking ? "1" : "0";
  }

  function scheduleBlink() {
    clearTimeout(blinkTimer);
    blinkTimer = setTimeout(() => {
      if (mood !== "dozing" && !document.hidden && !talking) {
        blinking = true;
        applyPose();
        setTimeout(() => {
          blinking = false;
          applyPose();
        }, 130);
      }
      scheduleBlink();
    }, 2600 + Math.random() * 2800);
  }

  function setCharacter(id) {
    if (!PORTRAIT_IDS.includes(id)) return false;
    charId = id;
    if (holder) holder.remove();
    holder = document.createElement("div");
    holder.id = "k2d-holder";
    holder.style.cssText =
      "position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;transition:transform 90ms ease-out";
    const size = document.createElement("div");
    // Motion-safe frame: every animation (breathe, gaze, talk-bob, mood
    // scale) must stay INSIDE the stage, or the head clips at the edge.
    size.style.cssText = "position:absolute;inset:14px";
    wrap = document.createElement("div");
    wrap.style.cssText =
      "position:absolute;inset:0;will-change:transform;transition:transform 0.3s cubic-bezier(.2,.8,.2,1)";
    breathe = document.createElement("div");
    // The portraits are transparent cutouts (rembg), so no edge masking is
    // needed — the character floats directly over whatever is behind the HUD.
    breathe.style.cssText =
      "position:absolute;inset:0;animation:k2d-breathe 4.2s ease-in-out infinite";
    const styleEl = document.createElement("style");
    styleEl.textContent =
      "@keyframes k2d-breathe{0%,100%{transform:translate(0,0) rotate(0deg)}50%{transform:translate(1.6px,-5px) rotate(-0.9deg)}}";
    breathe.appendChild(styleEl);
    const mkLayer = (kind, extra) => {
      const im = document.createElement("img");
      im.draggable = false;
      im.src = portraitSrc(charId, kind);
      // Transparent cutouts: contain keeps the whole character visible, and the
      // drop-shadow hugs the silhouette so she floats with depth over any app.
      im.style.cssText = `position:absolute;inset:0;width:100%;height:100%;object-fit:contain;filter:drop-shadow(0 8px 14px rgba(0,0,0,0.55));${extra}`;
      return im;
    };
    imgBase = mkLayer("", "");
    imgBlink = mkLayer("blink", "opacity:0;transition:opacity 90ms linear");
    imgMouth = mkLayer("mouth", "opacity:0;transition:opacity 70ms linear");
    breathe.appendChild(imgBase);
    breathe.appendChild(imgBlink);
    breathe.appendChild(imgMouth);
    wrap.appendChild(breathe);
    size.appendChild(wrap);
    holder.appendChild(size);
    stageEl.appendChild(holder);
    applyPose();
    scheduleBlink();
    return true;
  }

  function setMood(next) {
    mood = next || "idle";
    applyPose();
  }

  function setGaze(dx, dy) {
    gazeX = Math.max(-1, Math.min(1, dx || 0));
    gazeY = Math.max(-1, Math.min(1, dy || 0));
    applyPose();
  }

  function setSpeech(level, isTalking) {
    talking = Boolean(isTalking);
    speechLevel = Number(level) || 0;
    if (imgMouth) {
      // Threshold with hysteresis so the mouth flaps with the audio level
      // instead of flickering on quiet syllables.
      const nextOpen = talking && (mouthOpen ? speechLevel > 0.06 : speechLevel > 0.12);
      if (nextOpen !== mouthOpen) {
        mouthOpen = nextOpen;
        imgMouth.style.opacity = mouthOpen ? "1" : "0";
      }
    }
    // Talk-bob: the whole character bounces gently with the live audio level
    // so speech reads as physical motion, not just a swapping mouth.
    if (holder) {
      const bob = talking ? Math.min(4, speechLevel * 4) : 0;
      holder.style.transform = `translateY(${(-bob).toFixed(1)}px)`;
    }
  }

  function setStreaming() {}
  function destroy() {
    clearTimeout(blinkTimer);
    holder?.remove();
  }

  return { setCharacter, setMood, setGaze, setSpeech, setStreaming, destroy };
}

export { PORTRAIT_IDS, portraitSrc };
