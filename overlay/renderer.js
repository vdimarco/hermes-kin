import { mountAvatar, preloadAvatars } from "./kin-avatar.js";

const PERSONAS = [
  { id: "kin", label: "Kin", url: "kin" },
  { id: "elena", label: "Elena", url: "./avatars/elena.glb" },
  { id: "vance", label: "Vance", url: "./avatars/vance.glb" },
  { id: "kael", label: "Kael", url: "./avatars/kael.glb" },
  { id: "sera", label: "Sera", url: "./avatars/sera.glb" },
  { id: "freya", label: "Freya", url: "./avatars/freya.glb" },
  // Cartoon personas: 2D portraits (kin-2d.js), no 3D model.
  { id: "zip", label: "Zip", kind: "2d" },
  { id: "juno", label: "Juno", kind: "2d" },
  { id: "sprout", label: "Sprout", kind: "2d" },
  { id: "ollie", label: "Ollie", kind: "2d" },
  { id: "barley", label: "Barley", kind: "2d" },
  { id: "mochi", label: "Mochi", kind: "2d" },
  { id: "moss", label: "Moss", kind: "2d" },
];
const is2D = (p) => p?.kind === "2d";

const GLB_ICON = `<svg viewBox="50 22 100 130" xmlns="http://www.w3.org/2000/svg"><circle cx="100" cy="92" r="56" fill="#2c3550" stroke="#171720" stroke-width="3.5"/><ellipse cx="78" cy="95" rx="13" ry="15" fill="#fff"/><ellipse cx="122" cy="95" rx="13" ry="15" fill="#fff"/><circle cx="78" cy="95" r="5" fill="#8b92a0"/><circle cx="122" cy="95" r="5" fill="#8b92a0"/><path d="M64 62 Q64 34 100 32 Q136 34 136 62" fill="none" stroke="#4a5468" stroke-width="7"/></svg>`;

const root = document.getElementById("root");
const glCanvas = document.getElementById("gl");
const flatCanvas = document.getElementById("flat");
const stage = document.getElementById("stage");
import { mount2D } from "./kin-2d.js";
const micBtn = document.getElementById("mic-btn");
const eqBars = Array.from(document.querySelectorAll("#eq span"));
const personaBtn = document.getElementById("persona-btn");
const pillText = document.getElementById("pill-text");
const barMain = document.getElementById("bar-main");
const drawerToggle = document.getElementById("drawer-toggle");
const taskList = document.getElementById("task-list");
const askForm = document.getElementById("ask-row");
const askInput = document.getElementById("ask-input");
const countRecent = document.getElementById("count-recent");
const countFeed = document.getElementById("count-feed");

let avatar = null;
let currentMood = "idle";
let currentTab = "recent";
let loadedAvatarId = "kin";
let toastUntil = 0;
let lastState = {};
let micEnabled = true;

mountAvatar({
  glCanvas,
  flatCanvas,
  getPaused: () => false,
  forceFlat: false,
}).then((handle) => {
  avatar = handle;
  avatar.setMood(currentMood);
  // A 2D persona restored before the 3D engine finished loading: the engine
  // just made its canvas visible, so hide it again and remember its choice.
  if (mode2d) {
    savedCanvasDisplay = [glCanvas.style.display, flatCanvas.style.display];
    glCanvas.style.display = "none";
    flatCanvas.style.display = "none";
  }
  setTimeout(() => {
    preloadAvatars(PERSONAS.filter((p) => p.url).map((p) => p.url));
  }, 300);
});

// 2D portrait engine for the cartoon personas — mounted over the same stage.
const avatar2d = mount2D(stage);
let mode2d = false;
let savedCanvasDisplay = null;

function setMode2D(on) {
  if (on === mode2d) return;
  mode2d = on;
  if (on) {
    // Remember what the 3D engine chose (bust or flat fallback). The
    // stylesheet hides every canvas, so clearing the inline display on the
    // way back would leave the 3D avatar invisible.
    savedCanvasDisplay = [glCanvas.style.display, flatCanvas.style.display];
    glCanvas.style.display = "none";
    flatCanvas.style.display = "none";
  } else if (savedCanvasDisplay) {
    [glCanvas.style.display, flatCanvas.style.display] = savedCanvasDisplay;
  }
  const holder = document.getElementById("k2d-holder");
  if (holder) holder.style.display = on ? "flex" : "none";
}

// Show a persona on the stage: 2D portrait or 3D bust.
async function showPersona(p) {
  loadedAvatarId = p.id;
  personaBtn.textContent = "Avatar ▾";
  personaBtn.title = `Avatar — ${p.label}`;
  if (is2D(p)) {
    avatar2d.setCharacter(p.id);
    avatar2d.setMood(currentMood);
    setMode2D(true);
  } else {
    setMode2D(false);
    await avatar?.setAvatar?.(p.url);
  }
}

async function selectPersona(next) {
  await showPersona(next);
  window.kinFloat?.act?.({ kind: "set-avatar", avatarId: next.id, label: next.label });
  document.getElementById("char-picker").classList.remove("open");
}

// Character picker popover (right-click the persona pill)
const picker = document.getElementById("char-picker");
// Re-parent to #root: with the drawer collapsed (display:none) the picker
// would open inside a hidden container and the Avatar button looked dead.
document.getElementById("root").appendChild(picker);
PERSONAS.forEach((p) => {
  const b = document.createElement("button");
  b.className = "chip";
  b.dataset.id = p.id;
  b.type = "button";
  b.title = p.label;
  const faceSrc = is2D(p) ? `./avatars/toons/${p.id}.png` : `./avatars/persona-art/${p.id}.png`;
  const face = `<img class="chip-face-img" src="${faceSrc}" alt="${p.label}" draggable="false">`;
  b.innerHTML = `<span class="chip-face">${face}</span><span class="chip-label">${p.label}</span>`;
  b.addEventListener("click", (e) => {
    e.stopPropagation();
    selectPersona(p);
  });
  picker.appendChild(b);
});
function markActiveChip() {
  picker.querySelectorAll(".chip").forEach((c) => c.classList.toggle("active", c.dataset.id === loadedAvatarId));
}
personaBtn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  markActiveChip();
  picker.classList.toggle("open");
});
document.addEventListener("click", (e) => {
  if (!picker.contains(e.target) && e.target !== personaBtn) picker.classList.remove("open");
});

// Live Mic Meter — user speaking: 2D characters strike a listening pose
window.kinFloat?.onMic?.(({ active, level, bars, speaking }) => {
  micEnabled = Boolean(active);
  root.classList.toggle("mic-on", micEnabled);
  root.classList.toggle("mic-speaking", Boolean(micEnabled && speaking));
  if (micEnabled && mode2d) {
    avatar2d.setMood("attentive");
    avatar2d.setSpeech(0, false);
  }
  if (micEnabled) {
    eqBars.forEach((bar, idx) => {
      const bVal = Array.isArray(bars) ? Number(bars[idx] || 0) : Number(level || 0);
      const h = Math.max(3, Math.round(3 + bVal * 8));
      bar.style.height = `${h}px`;
    });
    if (speaking) {
      pillText.textContent = "Hearing you…";
      toastUntil = Date.now() + 800;
    }
  }
});

// Ordered playback queue: the main process streams a reply as sentence
// chunks; each plays as soon as it lands, in order, so speech starts with
// chunk 1 while later chunks are still synthesizing.
const speakQueue = [];
let speakLine = "";
let speakBusy = false;

function playSpeakChunk(mp3) {
  speakBusy = true;
  const ack = () => window.kinFloat?.act?.({ kind: "speak-ack", mp3 });
  const bail = () => window.kinFloat?.act?.({ kind: "speak-fallback", mp3 });
  const done = () => {
    avatar2d.setSpeech(0, false);
    speakingNow = false;
    root.classList.remove("char-speaking");
    speakBusy = false;
    drainSpeakQueue();
  };
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const el = new Audio(mp3);
    const srcNode = audioCtx.createMediaElementSource(el);
    const analyser = audioCtx.createAnalyser();
    analyser.fftSize = 512;
    srcNode.connect(analyser);
    analyser.connect(audioCtx.destination);
    const data = new Uint8Array(analyser.frequencyBinCount);
    let raf = 0;
    const loop = () => {
      if (el.paused || el.ended) return;
      analyser.getByteFrequencyData(data);
      let sum = 0;
      for (let i = 0; i < 48; i++) sum += data[i];
      const lvl = Math.min(1, (sum / 48) / 80);
      avatar2d.setSpeech(lvl * 1.5, true);
      raf = requestAnimationFrame(loop);
    };
    el.addEventListener("playing", () => {
      ack();
      speakingNow = true;
      root.classList.add("char-speaking");
      if (raf) cancelAnimationFrame(raf);
      raf = requestAnimationFrame(loop);
    });
    el.addEventListener("ended", () => {
      if (raf) cancelAnimationFrame(raf);
      done();
    });
    el.addEventListener("error", () => {
      if (!speakingNow) bail();
      done();
    });
    el.play().catch(() => {
      bail();
      done();
    });
  } catch {
    bail();
    done();
  }
}

function drainSpeakQueue() {
  if (speakBusy || !speakQueue.length) return;
  playSpeakChunk(speakQueue.shift());
}

window.kinFloat?.onSpeak?.(({ mp3, lineId } = {}) => {
  if (!mp3) return;
  // A new line flushes any queued remainder of the previous one; legacy
  // single-shot events (no lineId) always flush.
  if (!lineId || lineId !== speakLine) {
    speakLine = lineId || "";
    speakQueue.length = 0;
  }
  speakQueue.push(mp3);
  drainSpeakQueue();
});

micBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  window.kinFloat?.act?.({ kind: "toggle-mic" });
});

// ---- Mic engine (getUserMedia — cross-platform) ----
// Capture runs here in the renderer, so Linux, macOS and Windows all work
// with each OS's own permission prompt. VAD picks utterances and ships
// 16 kHz PCM to the main process for transcription (and drafting).
let micStream = null;
let micCtx = null;
let micNode = null;
let micSink = null;
let micEngSpeaking = false;
let micEngSpeech = [];
let micEngPreRoll = [];
let micEngSilence = 0;
let micEngFrames = 0;

window.kinFloat?.onMicCmd?.(({ action }) => {
  if (action === "start") micEngineStart();
  else if (action === "stop") micEngineStop();
});

async function micEngineStart() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    });
  } catch {
    micUI(false, "MIC NOT FOUND");
    window.kinFloat?.act?.({ kind: "mic-failed" });
    return;
  }
  micStream = stream;
  try {
    micCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
  } catch {
    micCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  const src = micCtx.createMediaStreamSource(micStream);
  micNode = micCtx.createScriptProcessor(2048, 1, 1);
  micNode.onaudioprocess = (e) => {
    const f32 = e.inputBuffer.getChannelData(0);
    let sumSq = 0;
    const bars = [0, 0, 0, 0];
    const quarter = Math.max(1, f32.length >> 2);
    for (let i = 0; i < f32.length; i++) {
      const v = f32[i];
      sumSq += v * v;
      const b = Math.min(3, Math.floor(i / quarter));
      if (Math.abs(v) > bars[b]) bars[b] = Math.abs(v);
    }
    const rms = Math.sqrt(sumSq / f32.length);
    const level = Math.min(1, rms * 12);
    const normBars = bars.map((v) => Math.min(1, v * 2.5));
    const isVoice = rms > 0.018;
    // VAD state machine — frame = 2048 samples ≈ 128 ms at 16 kHz.
    if (isVoice) {
      if (!micEngSpeaking) {
        micEngSpeaking = true;
        micEngSpeech = [...micEngPreRoll];
        micEngFrames = 0;
      }
      micEngSpeech.push(Float32Array.from(f32));
      micEngFrames += 1;
      micEngSilence = 0;
    } else {
      micEngPreRoll.push(Float32Array.from(f32));
      if (micEngPreRoll.length > 3) micEngPreRoll.shift();
      if (micEngSpeaking) {
        micEngSpeech.push(Float32Array.from(f32));
        micEngSilence += 1;
        // ~1s of trailing silence (or >10s of speech) ends the utterance.
        if (micEngSilence >= 8 || micEngFrames >= 80) {
          const full = micEngSpeech;
          micEngSpeaking = false;
          micEngSpeech = [];
          micEngSilence = 0;
          // Require ~0.5s of speech before spending an STT call.
          if (micEngFrames >= 4) shipUtterance(full, micCtx.sampleRate);
          micEngFrames = 0;
        }
      }
    }
    micUI(true, micEngSpeaking ? `HEARING ${Math.min(99, Math.round(level * 100))}%` : "MIC LIVE", level, normBars, micEngSpeaking);
  };
  src.connect(micNode);
  // The processor only runs when connected; sink at zero gain so the mic
  // never echoes back out.
  micSink = micCtx.createGain();
  micSink.gain.value = 0;
  micNode.connect(micSink);
  micSink.connect(micCtx.destination);
  micUI(true, "MIC LIVE");
}

function shipUtterance(chunks, sampleRate) {
  const flat = new Float32Array(chunks.reduce((n, c) => n + c.length, 0));
  let o = 0;
  for (const c of chunks) {
    flat.set(c, o);
    o += c.length;
  }
  let pcm = flat;
  if (Math.abs(sampleRate - 16000) > 1) {
    const ratio = sampleRate / 16000;
    const outLen = Math.floor(flat.length / ratio);
    pcm = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const t = i * ratio;
      const i0 = Math.floor(t);
      const i1 = Math.min(flat.length - 1, i0 + 1);
      pcm[i] = flat[i0] + (flat[i1] - flat[i0]) * (t - i0);
    }
  }
  const i16 = new Int16Array(pcm.length);
  for (let i = 0; i < pcm.length; i++) {
    const v = Math.max(-1, Math.min(1, pcm[i]));
    i16[i] = v < 0 ? v * 0x8000 : v * 0x7fff;
  }
  window.kinFloat?.sendVoice?.(i16.buffer);
}

function micEngineStop() {
  try { if (micNode) micNode.onaudioprocess = null; } catch {}
  try { if (micStream) micStream.getTracks().forEach((t) => t.stop()); } catch {}
  try { if (micCtx) micCtx.close(); } catch {}
  micStream = null;
  micCtx = null;
  micNode = null;
  micSink = null;
  micEngSpeaking = false;
  micEngSpeech = [];
  micEngPreRoll = [];
  micUI(false, "MIC OFF");
}

function micUI(active, _status, level = 0, bars = [0, 0, 0, 0], speaking = false) {
  micEnabled = active;
  root.classList.toggle("mic-on", active);
  root.classList.toggle("mic-speaking", Boolean(active && speaking));
  if (active) {
    eqBars.forEach((bar, idx) => {
      const bVal = Array.isArray(bars) ? Number(bars[idx] || 0) : Number(level || 0);
      bar.style.height = `${Math.max(3, Math.round(3 + bVal * 8))}px`;
    });
    if (speaking) {
      pillText.textContent = "Hearing you…";
      toastUntil = Date.now() + 800;
    }
  }
}

// Voice engine pill: cycles Kokoro (local, default) -> ElevenLabs -> OpenAI.
const voiceProviderBtn = document.getElementById("voice-provider-btn");
voiceProviderBtn.textContent = "Bella ▾";
voiceProviderBtn.title = "Voice — click to pick a voice for this avatar, right-click to test";
voiceProviderBtn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  window.kinFloat?.act?.({ kind: "tts-test" });
});
voiceProviderBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  window.kinFloat?.act?.({ kind: "get-voices" });
});

// --- Voice picker: engines on top, that engine's voices below ---
let voicePicker = null;
function closeVoicePicker() {
  if (voicePicker) { voicePicker.remove(); voicePicker = null; }
}
window.kinFloat?.onVoices?.((data) => {
  closeVoicePicker();
  const persona = (typeof PERSONAS !== "undefined" && PERSONAS.find((p) => p.id === (lastState?.avatarId || "kin"))) || { label: "Kin" };
  voicePicker = document.createElement("div");
  voicePicker.id = "voice-picker";
  const engineRow = ["kokoro", "elevenlabs", "openai"].map((pr) => {
    const nm = { kokoro: "Kokoro", elevenlabs: "ElevenLabs", openai: "OpenAI" }[pr];
    const cls = pr === data.provider ? "vp-engine active" : "vp-engine";
    return `<button class="${cls}" data-engine="${pr}">${nm}</button>`;
  }).join("");
  const sel = data.selected[data.provider] || data.defaults[data.provider];
  const chips = (data.voices[data.provider] || []).map((v) => {
    const cls = v.id === sel ? "vp-chip active" : "vp-chip";
    return `<button class="${cls}" data-voice="${v.id}" data-engine="${data.provider}">${v.label}</button>`;
  }).join("");
  voicePicker.innerHTML = `
    <div class="vp-title">Voice for ${persona.label || persona.name || "Kin"}</div>
    <div class="vp-engines">${engineRow}</div>
    <div class="vp-list">${chips}</div>
    <div class="vp-hint">Right-click the Voice pill anytime to hear a test</div>`;
  document.getElementById("root").appendChild(voicePicker);
  voicePicker.querySelectorAll(".vp-engine").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    window.kinFloat?.act?.({ kind: "set-tts-provider", provider: b.dataset.engine });
    setTimeout(() => window.kinFloat?.act?.({ kind: "get-voices" }), 350);
  }));
  voicePicker.querySelectorAll(".vp-chip").forEach((b) => b.addEventListener("click", (ev) => {
    ev.stopPropagation();
    window.kinFloat?.act?.({ kind: "set-voice", provider: b.dataset.engine, voice: b.dataset.voice });
    closeVoicePicker();
  }));
  const dismiss = (ev) => {
    if (voicePicker && !voicePicker.contains(ev.target) && ev.target !== voiceProviderBtn) {
      closeVoicePicker();
      document.removeEventListener("click", dismiss, true);
    }
  };
  document.addEventListener("click", dismiss, true);
});
// Right-click the mic for gpt-live conversation mode (Hermes full-duplex voice).
micBtn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  e.stopPropagation();
  window.kinFloat?.act?.({ kind: "gpt-live" });
});

// Avatar pill: left-click opens the persona picker (right-click works too)
personaBtn.addEventListener("click", (e) => {
  e.stopPropagation();
  markActiveChip();
  picker.classList.toggle("open");
});

// Drawer collapse / expand
if (localStorage.getItem("kin_hud_collapsed") === "1") {
  root.classList.add("collapsed");
}
function setDrawerOpen(open) {
  root.classList.toggle("collapsed", !open);
  localStorage.setItem("kin_hud_collapsed", open ? "0" : "1");
}

drawerToggle.addEventListener("click", (e) => {
  e.stopPropagation();
  const collapsed = root.classList.toggle("collapsed");
  localStorage.setItem("kin_hud_collapsed", collapsed ? "1" : "0");
});

// Clicking the status line opens the task list beneath it.
const statusLine = document.getElementById("status-line");
statusLine.addEventListener("click", (e) => {
  e.stopPropagation();
  if (root.classList.contains("collapsed")) setDrawerOpen(true);
});

window.kinFloat?.onGaze?.(({ dx, dy }) => {
  avatar?.setGaze(dx, dy);
  avatar2d.setGaze(dx, dy);
});

let toastHistory = [];
window.kinFloat?.onToast?.((msg) => {
  toastUntil = Date.now() + 4000;
  const text = msg.replace(/^[^\w\s]+\s*/, "");
  toastHistory.push({ text, at: Date.now() });
  if (toastHistory.length > 12) toastHistory.shift();
  pillText.textContent = text;
});

function formatAge(sec) {
  if (!sec || sec < 45) return "now";
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function escapeHtml(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const STATUS_WORD = {
  running: "Running",
  done: "Done",
  failed: "Failed",
  queued: "Queued",
  ready: "Ready",
  live: "Live",
};

function rowHtml(it) {
  const st = it.status || "ready";
  const word = STATUS_WORD[st] || st;
  const meta = `${word} · ${formatAge(it.ageSec)}`;
  const label = String(it.label || "").trim();
  const desc = String(it.sub || "").trim();
  return `
    <div class="row" data-nav="${escapeHtml(it.nav || "")}" data-program="${escapeHtml(it.program || "")}" data-pid="${it.pid || 0}" title="${escapeHtml(desc || label)}">
      <div class="row-left">
        <span class="dot ${escapeHtml(st)}"></span>
        <div class="row-text">
          <div class="row-title">${escapeHtml(label)}</div>
          ${desc ? `<div class="row-sub">${escapeHtml(desc)}</div>` : ""}
        </div>
      </div>
      <span class="row-meta ${escapeHtml(st)}">${escapeHtml(meta)}</span>
    </div>`;
}

const ALL_CLEAR_HTML = `
  <div class="row">
    <div class="row-left">
      <span class="dot done"></span>
      <div class="row-text">
        <div class="row-title">All clear</div>
        <div class="row-sub">No active tasks — Hermes is idle</div>
      </div>
    </div>
    <span class="row-meta done">idle · now</span>
  </div>`;

function sectionHtml(title, items, limit) {
  const slice = items.slice(0, limit);
  if (!slice.length) return "";
  return `<div class="section-label">${title}</div>` + slice.map(rowHtml).join("");
}

function renderTab() {
  const active = lastState.activeTasks || [];
  const recent = lastState.recentTasks || [];
  const feed = lastState.feedTasks || [];
  const desktop = lastState.desktop || {};

  const taskItems = [...active, ...recent];
  const toastItems = toastHistory.slice(-4).reverse().map((t) => ({
    label: "Kin",
    sub: t.text,
    status: "ready",
    ageSec: Math.max(0, (Date.now() - t.at) / 1000),
  }));
  const feedItems = [
    ...(desktop.class
      ? [{ label: desktop.class, sub: `Focused window — ${desktop.title || "untitled"}`, status: "live", ageSec: 0 }]
      : []),
    ...toastItems,
    ...feed,
  ];

  countRecent.textContent = String(taskItems.length);
  countFeed.textContent = String(feedItems.length);

  if (currentTab === "feed") {
    const items = feedItems.slice(0, 6);
    taskList.innerHTML = items.length ? items.map(rowHtml).join("") : ALL_CLEAR_HTML;
  } else {
    const running = taskItems.filter((i) => i.status === "running");
    const queued = taskItems.filter((i) => i.status === "queued");
    const others = taskItems.filter((i) => i.status !== "running" && i.status !== "queued");
    let html = sectionHtml("Running", running, 3);
    html += sectionHtml("Queued", queued, 2);
    html += sectionHtml("Recent", others, 2);
    taskList.innerHTML = html || ALL_CLEAR_HTML;
  }

  taskList.querySelectorAll(".row").forEach((row) => {
    row.addEventListener("click", () => {
      const program = row.getAttribute("data-program") || "";
      if (program) {
        // Non-Hermes task (Claude, Codex, ...): focus its window.
        window.kinFloat?.act?.({ kind: "focus-process", program, pid: Number(row.getAttribute("data-pid")) || 0, nav: row.getAttribute("data-nav") || "" });
        return;
      }
      const nav = row.getAttribute("data-nav") || "";
      window.kinFloat?.act?.({ kind: "focus-hermes", nav });
    });
  });
}

// First-run onboarding: three one-time hints so the HUD explains itself.
let onboardShown = false;
function maybeOnboard() {
  if (onboardShown) return;
  onboardShown = true;
  if (localStorage.getItem("kin_onboarded") === "1") return;
  localStorage.setItem("kin_onboarded", "1");
  const steps = [
    "👋 Click the head to open Hermes",
    "🎙 The mic is opt-in — tap the mic button to talk",
    "📸 The camera icon asks Hermes about your screen",
  ];
  steps.forEach((s, i) => {
    setTimeout(() => {
      toastUntil = Date.now() + 4200;
      pillText.textContent = s;
    }, 1500 + i * 5000);
  });
}

window.kinFloat?.onState?.((state) => {
  lastState = state || {};
  const { mood, line, streaming, avatarId, voiceActive } = lastState;
  // Live selection labels on the pills: "<Avatar name> ▾" / "<Voice> ▾".
  {
    const sel = (typeof PERSONAS !== "undefined" && PERSONAS.find((p) => p.id === (avatarId || "kin")));
    const selName = sel ? (sel.label || sel.name) : null;
    if (selName && personaBtn.textContent !== `${selName} ▾`) personaBtn.textContent = `${selName} ▾`;
    if (lastState.voiceLabel && voiceProviderBtn.textContent !== `${lastState.voiceLabel} ▾`) {
      voiceProviderBtn.textContent = `${lastState.voiceLabel} ▾`;
    }
  }
  // Mic indicator must mirror the real mic state, not the hardcoded default:
  // mic-on only when kin's mic loop is actually running.
  micEnabled = Boolean(voiceActive);
  root.classList.toggle("mic-on", micEnabled);
  if (!micEnabled) root.classList.remove("mic-speaking");
  if (avatarId && avatarId !== loadedAvatarId) {
    const found = PERSONAS.find((p) => p.id === avatarId);
    if (found) showPersona(found);
  }
  if (mood && mood !== currentMood) {
    // The 3D mount callback applies currentMood once it loads.
    currentMood = mood;
    avatar?.setMood(mood);
    avatar2d.setMood(mood);
  }
  if (Date.now() > toastUntil) {
    const cleanLine = (line || "").replace(/^[^\w\s]+\s*/, "");
    pillText.textContent = cleanLine || (micEnabled ? "Listening…" : "Idle");
  }
  avatar?.setStreaming(Boolean(streaming || micEnabled));
  maybeOnboard();
  renderTab();
});

stage.addEventListener("click", () => {
  avatar?.setMood("attentive");
  window.kinFloat?.act?.({ kind: "focus-hermes" });
});

barMain.addEventListener("click", () => {
  window.kinFloat?.act?.({ kind: "focus-hermes" });
});

document.querySelectorAll(".d-tab").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    document.querySelectorAll(".d-tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    currentTab = btn.getAttribute("data-tab") || "recent";
    renderTab();
  });
});

document.querySelectorAll("[data-act]").forEach((btn) => {
  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const kind = btn.getAttribute("data-act");
    avatar?.setMood("watching");
    window.kinFloat?.act?.({ kind });
  });
});

// Ask history — ArrowUp/ArrowDown recalls previous prompts (persisted locally).
let askHistory = [];
try {
  askHistory = JSON.parse(localStorage.getItem("kin_ask_history") || "[]");
} catch {}
let askHistIdx = -1;
askInput.addEventListener("keydown", (e) => {
  if (e.key === "ArrowUp" && askHistory.length) {
    e.preventDefault();
    askHistIdx = askHistIdx === -1 ? askHistory.length - 1 : Math.max(0, askHistIdx - 1);
    askInput.value = askHistory[askHistIdx];
  } else if (e.key === "ArrowDown" && askHistIdx !== -1) {
    e.preventDefault();
    askHistIdx += 1;
    if (askHistIdx >= askHistory.length) {
      askHistIdx = -1;
      askInput.value = "";
    } else {
      askInput.value = askHistory[askHistIdx];
    }
  }
});

askForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = askInput.value.trim();
  if (!text) return;
  askInput.value = "";
  // Reject the retired command before it can enter history or the prompt relay.
  if (/^tts\s+key\b/i.test(text)) {
    toastUntil = Date.now() + 2500;
    pillText.textContent = "Configure TTS credentials in Hermes settings.";
    return;
  }
  askHistory.push(text);
  if (askHistory.length > 20) askHistory.shift();
  localStorage.setItem("kin_ask_history", JSON.stringify(askHistory));
  askHistIdx = -1;
  avatar?.setMood("thinking");
  window.kinFloat?.act?.({ kind: "ask", text });
});

stage.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  window.kinFloat?.quit?.();
});
