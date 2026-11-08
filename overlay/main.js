// Kin Float — floating companion HUD for Omarchy/Hyprland.
const { app, BrowserWindow, ipcMain, session } = require("electron");
const { execFile, spawn } = require("child_process");
const net = require("net");
const path = require("path");
const os = require("os");
const fs = require("fs");

function resolveHyprSocketPath() {
  try {
    const xdg = process.env.XDG_RUNTIME_DIR || `/run/user/${process.getuid?.() || 1000}`;
    const hyprDir = path.join(xdg, "hypr");
    const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE || fs.readdirSync(hyprDir)[0];
    return path.join(hyprDir, sig, ".socket.sock");
  } catch {
    return "";
  }
}

const HYPR_SOCK = resolveHyprSocketPath();

function hyprSocketCmd(cmd, cb) {
  if (!HYPR_SOCK) return cb("");
  const sock = net.createConnection(HYPR_SOCK);
  let out = "";
  sock.setTimeout(250);
  sock.on("connect", () => sock.write(cmd));
  sock.on("data", (d) => {
    out += d.toString();
  });
  sock.on("end", () => cb(out));
  sock.on("error", () => cb(""));
  sock.on("timeout", () => {
    sock.destroy();
    cb("");
  });
}

app.commandLine.appendSwitch("disable-setuid-sandbox");
app.commandLine.appendSwitch("no-zygote-sandbox");

let win;
let db = null;
let stateDb = null;
let lastEventId = 0;
let lastActiveDesktopWin = { class: "Desktop", title: "Desktop", at: [0, 0], size: [1920, 1080] };
let latestTerminalSnippet = "";
let voiceActiveLocal = false;

function openKinDb() {
  if (db) return db;
  try {
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = path.join(os.homedir(), ".hermes", "plugin-data", "kin", "data.db");
    db = new DatabaseSync(dbPath);
    return db;
  } catch {
    return null;
  }
}

function openStateDb() {
  if (stateDb) return stateDb;
  try {
    const { DatabaseSync } = require("node:sqlite");
    const dbPath = path.join(os.homedir(), ".hermes", "state.db");
    stateDb = new DatabaseSync(dbPath, { readOnly: true });
    return stateDb;
  } catch {
    return null;
  }
}

function setKinSetting(key, value) {
  const conn = openKinDb();
  if (!conn) return false;
  try {
    const up = conn.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    up.run(String(key), String(value ?? ""));
    return true;
  } catch {
    return false;
  }
}

function queueKinPrompt(promptText, statusLine) {
  const conn = openKinDb();
  if (!conn) return false;
  try {
    const up = conn.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    up.run("pending_prompt", String(promptText || ""));
    if (statusLine) {
      up.run("mood", "thinking");
      up.run("line", String(statusLine));
    }
    return true;
  } catch {
    return false;
  }
}

function queueKinDraft(draftText, statusLine) {
  // Voice never auto-sends: transcripts land in the Hermes composer as a
  // draft the user reviews and sends (matches the pane's "Kin never sends" rule).
  const conn = openKinDb();
  if (!conn) return false;
  try {
    const up = conn.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    );
    up.run("pending_draft", String(draftText || ""));
    if (statusLine) {
      up.run("mood", "thinking");
      up.run("line", String(statusLine));
    }
    return true;
  } catch {
    return false;
  }
}

function logKinEvent(kind, name, ok, detail) {
  const conn = openKinDb();
  if (!conn) return;
  try {
    conn
      .prepare("INSERT INTO events (ts, session_id, kind, name, ok, detail) VALUES (?, '', ?, ?, ?, ?)")
      .run(Date.now() / 1000, String(kind), String(name), ok ? 1 : 0, String(detail || "").slice(0, 180));
    conn.execute(
      "DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 400)"
    );
  } catch {}
}

function setKinSleep(asleep) {
  setKinSetting("sleep", asleep ? "true" : "false");
  setKinSetting("mood", asleep ? "dozing" : "idle");
  setKinSetting("line", asleep ? "Asleep." : "Here.");
}

function pollKinDb() {
  const conn = openKinDb();
  if (!conn) return null;
  try {
    const settingsRows = conn.prepare("SELECT key, value FROM settings").all();
    const settings = {};
    for (const r of settingsRows) settings[r.key] = r.value;
    const events = conn.prepare("SELECT id, ts, kind, name, ok, detail FROM events ORDER BY id DESC LIMIT 12").all();
    return { settings, latest: events[0] || null, events };
  } catch {
    return null;
  }
}

function plainProgramName(cmd) {
  // Reduce a raw shell command to the plain name of what runs: strip env
  // assignments, cd prefixes, and shell keywords, then take the program
  // basename ("export STEAM_...; exec steam" -> "Steam").
  let text = String(cmd || "").replace(/\n/g, " ");
  text = text.replace(/(export\s+)?[A-Za-z_][A-Za-z0-9_]*=(\\?"[^"]*\\?|\S*)/g, " ");
  text = text.replace(/\bcd\s+\S+(\s*&&\s*)?/g, " ");
  text = text.replace(/\b(exec|export|bash|sh|source)\b/g, " ");
  const token = text.trim().split(/\s+/).find(Boolean) || "";
  const base = token.split("/").pop().replace(/\.(sh|py|js)$/, "") || "Background task";
  return base.charAt(0).toUpperCase() + base.slice(1);
}

function readTasksAndRecent(kinEvents) {
  const nowSec = Date.now() / 1000;
  const active = [];
  const recent = [];

  // 1. Query Hermes state.db for active turn leases, delegations, and recent sessions
  const sdb = openStateDb();
  const leasedIds = new Set();
  if (sdb) {
    try {
      const leases = sdb.prepare("SELECT session_id FROM session_turn_leases").all();
      for (const l of leases) {
        if (l.session_id) leasedIds.add(l.session_id);
      }
    } catch {}

    try {
      const sessions = sdb
        .prepare(
          "SELECT id, title, last_activity_description, last_activity_at, ended_at, tool_call_count FROM sessions WHERE hidden = 0 AND archived = 0 ORDER BY last_activity_at DESC LIMIT 8"
        )
        .all();
      for (const s of sessions) {
        const isLeased = leasedIds.has(s.id);
        const ageSec = Math.max(0, nowSec - Number(s.last_activity_at || 0));
        const cleanTitle = String(s.title || s.id).replace(/\s*·\s*[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}$/, "");
        const sub = s.last_activity_description || (s.tool_call_count ? `${s.tool_call_count} tools run` : "Session");
        if (isLeased) {
          active.push({
            id: s.id,
            nav: `/${s.id}`,
            label: cleanTitle,
            sub: sub ? `Agent working — ${sub}` : "Agent turn running in this session",
            status: "running",
            ageSec,
          });
        } else {
          recent.push({
            id: s.id,
            nav: `/${s.id}`,
            label: cleanTitle,
            sub: sub || (s.ended_at ? "Session finished" : "Waiting for your next message"),
            status: s.ended_at ? "done" : "ready",
            ageSec,
          });
        }
      }
    } catch {}
  }

  // 2. Background processes from ~/.hermes/processes.json — grouped by the
  // Hermes session that started them and labeled in plain English (the
  // session's title, or the plain program name), with a real age.
  try {
    const pFile = path.join(os.homedir(), ".hermes", "processes.json");
    if (fs.existsSync(pFile)) {
      const list = JSON.parse(fs.readFileSync(pFile, "utf8"));
      if (Array.isArray(list)) {
        const groups = new Map();
        for (const p of list) {
          const cmd = String(p.command || "").trim();
          if (!cmd || cmd.includes("kin-float")) continue;
          const key = String(p.parent_session_id || p.session_id || "bg");
          if (!groups.has(key)) groups.set(key, []);
          groups.get(key).push(p);
        }
        const parentIds = [...groups.keys()].filter((k) => k && k !== "bg");
        const titles = new Map();
        if (sdb && parentIds.length) {
          try {
            const marks = parentIds.map(() => "?").join(",");
            const rows = sdb
              .prepare(`SELECT id, title FROM sessions WHERE id IN (${marks})`)
              .all(...parentIds);
            for (const r of rows) {
              titles.set(
                String(r.id),
                String(r.title || "").replace(/\s*·\s*[A-Z][a-z]{2}\s+\d{2}\s+\d{2}:\d{2}$/, "")
              );
            }
          } catch {}
        }
        for (const [key, entries] of groups) {
          const oldest = entries.reduce((a, b) =>
            Number(a.started_at || 0) <= Number(b.started_at || 0) ? a : b
          );
          const label = titles.get(key) || plainProgramName(entries[0].command);
          const ageSec = Number(oldest.started_at) > 0
            ? Math.max(0, nowSec - Number(oldest.started_at))
            : 0;
          const pidText =
            entries.length > 1
              ? `${entries.length} background processes · oldest PID ${oldest.pid || "bg"}`
              : `Background process · PID ${entries[0].pid || "bg"}`;
          active.push({
            id: key,
            nav: key && key !== "bg" ? `/${key}` : "",
            label: String(label).slice(0, 48),
            sub: `Running in background · ${pidText}`,
            status: "running",
            ageSec,
          });
        }
      }
    }
  } catch {}

  // 3. OMH active todo items from ~/.omh/runtime/todos/
  try {
    const tDir = path.join(os.homedir(), ".omh", "runtime", "todos");
    if (fs.existsSync(tDir)) {
      const files = fs.readdirSync(tDir).filter((f) => f.endsWith(".json"));
      for (const f of files.slice(-2)) {
        const data = JSON.parse(fs.readFileSync(path.join(tDir, f), "utf8"));
        for (const it of data.items || []) {
          const st = String(it.state || "todo").toLowerCase();
          const sub =
            st === "in_progress"
              ? "Plan checklist — in progress"
              : st === "done"
              ? "Plan checklist — completed"
              : "Plan checklist — pending";
          const entry = {
            id: `todo-${it.text}`,
            nav: "",
            label: String(it.text || "").slice(0, 48),
            sub,
            status: st === "done" ? "done" : st === "in_progress" ? "running" : "queued",
            ageSec: 0,
          };
          if (entry.status === "done") recent.push(entry);
          else active.push(entry);
        }
      }
    }
  } catch {}

  // 4. Recent tool/turn events from Kin DB
  const feed = [];
  for (const ev of kinEvents || []) {
    const ok = Boolean(ev.ok);
    const ageSec = Math.max(0, nowSec - Number(ev.ts || nowSec));
    const detail = ev.detail ? String(ev.detail).slice(0, 52) : "";
    feed.push({
      id: `ev-${ev.id}`,
      nav: "",
      label: ev.name || ev.kind || "step",
      sub: ok
        ? detail || (ev.kind === "turn" ? "Turn completed successfully" : "Tool ran successfully")
        : detail
        ? `Failed: ${detail.slice(0, 44)}`
        : "Failed",
      status: ok ? "done" : "failed",
      ageSec,
    });
  }

  return {
    active: active.slice(0, 6),
    recent: [...recent.slice(0, 4), ...feed.slice(0, 4)].slice(0, 6),
    feed: feed.slice(0, 6),
  };
}

function captureAndOcrGeometry(geom, outBase, cb) {
  const png = `/home/von/.hermes/cache/scratch/${outBase}.png`;
  execFile("grim", ["-g", geom, png], { timeout: 2500 }, (err) => {
    if (err) return cb("");
    execFile("tesseract", [png, "stdout", "--psm", "6"], { timeout: 4000 }, (err2, stdout) => {
      const cleaned = String(stdout || "")
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean)
        .slice(-18)
        .join("\n")
        .slice(0, 1400);
      cb(cleaned, png);
    });
  });
}

function scanTerminalText(cb) {
  execFile("hyprctl", ["clients", "-j"], { timeout: 800 }, (err, stdout) => {
    if (!err && stdout) {
      try {
        const clients = JSON.parse(stdout);
        const term = clients.find(
          (c) =>
            ["foot", "ghostty", "Alacritty", "kitty", "so.pen.herdr-gpui"].includes(c.class) &&
            c.mapped &&
            !c.hidden &&
            Array.isArray(c.at) &&
            Array.isArray(c.size) &&
            c.at[0] >= 0
        );
        if (term) {
          const geom = `${term.at[0]},${term.at[1]} ${term.size[0]}x${term.size[1]}`;
          return captureAndOcrGeometry(geom, "kin-term-ocr", (text, png) => {
            cb({ source: `${term.class} (${term.title || "terminal"})`, text, png });
          });
        }
      } catch {}
    }
    try {
      const outDir = path.join(os.homedir(), ".hermes", "cache", "terminal-output");
      if (fs.existsSync(outDir)) {
        const files = fs
          .readdirSync(outDir)
          .map((n) => ({ n, t: fs.statSync(path.join(outDir, n)).mtimeMs }))
          .sort((a, b) => b.t - a.t);
        if (files.length) {
          const raw = fs.readFileSync(path.join(outDir, files[0].n), "utf8");
          const tail = raw.trim().split("\n").slice(-16).join("\n").slice(0, 1200);
          return cb({ source: "Hermes terminal output", text: tail, png: "" });
        }
      }
    } catch {}
    cb({ source: "terminal", text: "", png: "" });
  });
}

function scanDesktopWindow(cb) {
  const w = lastActiveDesktopWin;
  if (w && Array.isArray(w.at) && Array.isArray(w.size) && w.size[0] > 50 && w.at[0] >= 0) {
    const geom = `${w.at[0]},${w.at[1]} ${w.size[0]}x${w.size[1]}`;
    return captureAndOcrGeometry(geom, "kin-desktop-ocr", (text, png) => {
      cb({ app: w.class || "Desktop", title: w.title || "", text, png });
    });
  }
  cb({ app: w.class || "Desktop", title: w.title || "", text: "", png: "" });
}

function createWindow() {
  win = new BrowserWindow({
    width: 330,
    height: 535,
    transparent: true,
    frame: false,
    resizable: false,
    movable: true,
    skipTaskbar: true,
    fullscreenable: false,
    alwaysOnTop: true,
    hasShadow: false,
    backgroundColor: "#00000000",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  });

  win.setAlwaysOnTop(true, "floating");
  win.webContents.on("console-message", (e, level, message) => {
    console.log("[renderer]", message);
  });

  // 1. Poll global Wayland cursor via zero-spawn Hyprland UNIX socket (~40fps)
  let pollingCursor = false;
  setInterval(() => {
    if (!win || win.isDestroyed() || pollingCursor) return;
    pollingCursor = true;
    hyprSocketCmd("cursorpos", (stdout) => {
      pollingCursor = false;
      if (!stdout || !win || win.isDestroyed()) return;
      const parts = stdout.trim().split(",");
      if (parts.length < 2) return;
      const cx = Number(parts[0].trim());
      const cy = Number(parts[1].trim());
      if (!Number.isFinite(cx) || !Number.isFinite(cy)) return;
      // Anchor gaze at the overlay's own on-screen position so the avatar
      // tracks correctly on any monitor size or position — never a fixed point.
      const [winX, winY] = win.getPosition();
      const [winW, winH] = win.getContentSize();
      const refX = winX + winW / 2;
      const refY = winY + Math.min(150, winH * 0.28);
      const dx = Math.max(-1, Math.min(1, (cx - refX) / 900));
      const dy = Math.max(-1, Math.min(1, (cy - refY) / 500));
      win.webContents.send("kin:gaze", { dx, dy });
    });
  }, 25);

  // 2. Watch active desktop window via zero-spawn Hyprland UNIX socket
  let pollingWin = false;
  setInterval(() => {
    if (!win || win.isDestroyed() || pollingWin) return;
    pollingWin = true;
    hyprSocketCmd("j/activewindow", (stdout) => {
      pollingWin = false;
      if (!stdout) return;
      try {
        const active = JSON.parse(stdout);
        if (active && active.class && active.class !== "kin-float") {
          lastActiveDesktopWin = {
            class: active.class,
            title: active.title || active.class,
            at: active.at || [0, 0],
            size: active.size || [1920, 1080],
          };
        }
      } catch {}
    });
  }, 1000);

  // 3. Poll Kin SQLite state + tasks + voice state
  let transientMoodUntil = 0;
  let transientMood = null;
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    const state = pollKinDb();
    if (!state) return;
    const { settings, latest, events } = state;
    const now = Date.now();
    const lists = readTasksAndRecent(events);
    const asleep = ["1", "true", "yes", "on"].includes(String(settings.sleep || "").toLowerCase());
    const voiceActive =
      voiceActiveLocal || ["1", "true", "yes", "on"].includes(String(settings.voice_active || "").toLowerCase());

    let mood = "idle";
    let line = `Watching ${lastActiveDesktopWin.class || "Desktop"}`;
    let streaming = false;

    if (asleep) {
      mood = "dozing";
      line = "Asleep.";
    } else if (voiceActive) {
      mood = "attentive";
      line = "GPT Live Voice · Listening";
      streaming = true;
    } else {
      if (latest && latest.id !== lastEventId) {
        const isInitial = lastEventId === 0;
        lastEventId = latest.id;
        if (!isInitial && now / 1000 - latest.ts < 15) {
          if (!latest.ok) {
            transientMood = {
              mood: "concerned",
              line: `${latest.name || "step"} failed${latest.detail ? ": " + latest.detail.slice(0, 42) : "."}`,
            };
            transientMoodUntil = now + 8000;
          } else if (latest.kind === "tool") {
            transientMood = { mood: "watching", line: `Running ${latest.name || "tool"}…` };
            transientMoodUntil = now + 4500;
          }
        }
      }
      if (transientMood && now < transientMoodUntil) {
        mood = transientMood.mood;
        line = transientMood.line;
      } else if (settings.mood && settings.mood !== "idle") {
        mood = settings.mood;
        line = settings.line || line;
        streaming = settings.mood === "attentive";
      } else if (lists.active.length > 0) {
        mood = "watching";
        line = `${lists.active[0].label.slice(0, 34)}`;
      }
    }

    win.webContents.send("kin:state", {
      mood,
      line,
      streaming,
      voiceActive,
      avatarId: settings.avatar_id || "kin",
      desktop: lastActiveDesktopWin,
      activeTasks: lists.active,
      recentTasks: lists.recent,
      feedTasks: lists.feed,
      terminalSnippet: latestTerminalSnippet,
    });
  }, 500);

  win.loadFile(path.join(__dirname, "index.html"));
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(true);
  });
  session.defaultSession.setPermissionCheckHandler(() => true);
  createWindow();
  // Reconcile the persona voice with the restored avatar_id: a stale
  // avatar_voice from an earlier persona (or a hand-set avatar_id) must
  // never make a character speak in another character's voice.
  const savedAvatarId = pollKinDb()?.settings?.avatar_id || "kin";
  setKinSetting("avatar_voice", (AVATAR_VOICES[savedAvatarId] || AVATAR_VOICES.kin).voice);
  // Mic is strictly opt-in: never auto-start listening on launch. The user
  // must toggle it on from the overlay. Clear any stale "live" state so the
  // HUD and shared settings show the mic as off after a restart.
  voiceActiveLocal = false;
  setKinSetting("voice_active", "false");
  setKinSetting("mood", "idle");
  setKinSetting("line", "Mic off.");

  // Self-test hook: KIN_SAY_ID=<avatarId> kin-float → on launch, switch to
  // that persona and speak its greet line (renderer lip-sync path included).
  const testId = process.env.KIN_SAY_ID;
  if (testId && AVATAR_VOICES[testId]) {
    setTimeout(() => {
      const meta = AVATAR_VOICES[testId];
      setKinSetting("avatar_id", testId);
      setKinSetting("avatar_voice", meta.voice);
      if (win && !win.isDestroyed()) {
        win.webContents.send("kin:toast", `${meta.role} · Voice: ${meta.voice}`);
      }
      speakCharacterLine(meta.voice, meta.greet, meta.instructions);
    }, 2500);
  }
});

let micProc = null;
let micRunning = false;
let micSpeaking = false;
let micSpeechBuffers = [];
let micPreRoll = [];
let micSilenceFrames = 0;
let micSpeechFrames = 0;
let micTranscribing = false;
let lastAutoPrompt = "";
let lastAutoPromptAt = 0;
const AUTO_PROMPT_DEDUPE_MS = 10 * 60 * 1000;

function writePcmWav(filePath, pcmBuffer, sampleRate = 16000) {
  const header = Buffer.alloc(44);
  const dataLen = pcmBuffer.length;
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + dataLen, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // Mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(dataLen, 40);
  fs.writeFileSync(filePath, Buffer.concat([header, pcmBuffer]));
}

function localWhisperTranscribe(wavPath, cb) {
  // Fast path: a local whisper.cpp build (KIN_WHISPER_BIN, or whisper-cli on
  // PATH) with a ggml model (KIN_WHISPER_MODEL, or the first model in
  // ~/.local/opt/whisper.cpp/models) transcribes offline. Absent either, fall
  // back to Hermes's configured STT provider.
  const bin = process.env.KIN_WHISPER_BIN || "whisper-cli";
  let model = process.env.KIN_WHISPER_MODEL || "";
  if (!model) {
    try {
      const dir = path.join(os.homedir(), ".local", "opt", "whisper.cpp", "models");
      const found = fs.readdirSync(dir).find((f) => /^ggml-.*\.bin$/.test(f));
      if (found) model = path.join(dir, found);
    } catch {}
  }
  if (!model) return cb(null);
  execFile(bin, ["-m", model, "-f", wavPath, "-nt"], { timeout: 20000 }, (err, stdout) => {
    if (err) return cb(null);
    const text = String(stdout || "").trim();
    cb(text || null);
  });
}

function transcribeUtteranceBuffer(pcmBuffer) {
  if (micTranscribing || pcmBuffer.length < 9600) return;
  micTranscribing = true;
  const wavPath = `/home/von/.hermes/cache/scratch/kin-utt-${Date.now()}.wav`;
  try {
    writePcmWav(wavPath, pcmBuffer, 16000);
  } catch {
    micTranscribing = false;
    return;
  }
  if (win && !win.isDestroyed()) {
    win.webContents.send("kin:mic", { active: true, level: 0.1, speaking: false, status: "SENDING…" });
    win.webContents.send("kin:toast", "🎙 Transcribing speech…");
  }
  localWhisperTranscribe(wavPath, (localText) => {
    if (localText !== null) {
      finishTranscription(wavPath, { success: true, transcript: localText });
      return;
    }
    const pyCode = [
      "import sys, json",
      'sys.path.insert(0, "/home/von/.hermes/hermes-agent")',
      "from tools.voice_mode import transcribe_recording",
      "res = transcribe_recording(sys.argv[1])",
      'print("KIN_STT_JSON:" + json.dumps(res))',
    ].join("; ");
    execFile("python3", ["-c", pyCode, wavPath], { timeout: 25000 }, (err, stdout) => {
      const out = String(stdout || "");
      const m = out.match(/KIN_STT_JSON:(\{.*\})/);
      let parsed = null;
      if (m) {
        try {
          parsed = JSON.parse(m[1]);
        } catch {}
      }
      finishTranscription(wavPath, parsed);
    });
  });
}

function finishTranscription(wavPath, parsed) {
  micTranscribing = false;
  try {
    fs.unlinkSync(wavPath);
  } catch {}
  if (!parsed) return;
  try {
    const text = String(parsed.transcript || "").trim();
    if (parsed.success && text) {
      // Guard against STT loop storms: Whisper can emit the same phantom
      // phrase ("like, comment, subscribe"-family) for every notification
      // chime or steady room noise. One identical auto-sent transcript per
      // cooldown window; later duplicates are dropped until a different
      // transcript goes through.
      const norm = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
      const now = Date.now();
      if (norm && norm === lastAutoPrompt && now - lastAutoPromptAt < AUTO_PROMPT_DEDUPE_MS) {
        logKinEvent("voice", "duplicate-skipped", true, text.slice(0, 80));
        if (win && !win.isDestroyed()) {
          win.webContents.send("kin:toast", `🔇 Duplicate transcript skipped: "${text.slice(0, 40)}"`);
        }
        return;
      }
      lastAutoPrompt = norm;
      lastAutoPromptAt = now;
      // Voice never auto-sends: the transcript lands in the composer as a
      // draft the user reviews and sends (the pane's "Kin never sends" rule).
      queueKinDraft(text, `Heard: "${text.slice(0, 34)}"`);
      focusHermesWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send("kin:toast", `🗣 "${text.slice(0, 44)}"`);
      }
    }
  } catch {}
}

let micDeviceCache = null;
let micStartAttempts = 0;
let micStartedAt = 0;

function resolveMicDevice(cb) {
  // Prefer the EMEET Pixy when it is connected; otherwise the PulseAudio
  // default source. A missing hardcoded device used to spin the restart loop.
  if (micDeviceCache) return cb(micDeviceCache);
  execFile("/usr/bin/pactl", ["list", "sources", "short"], { timeout: 3000 }, (err, stdout) => {
    const out = String(stdout || "");
    micDeviceCache = out.includes("EMEET_EMEET_PIXY")
      ? "alsa_input.usb-EMEET_EMEET_PIXY_A260801001005911-02.mono-fallback"
      : "@DEFAULT_SOURCE@";
    cb(micDeviceCache);
  });
}

function startNativeMicLoop() {
  if (micRunning) return;
  micRunning = true;
  voiceActiveLocal = true;
  setKinSetting("voice_active", "true");
  setKinSetting("mood", "attentive");
  setKinSetting("line", "🎙 Mic Live · Speak anytime");
  resolveMicDevice((device) => {
    if (!micRunning) return;
    micStartedAt = Date.now();
    micProc = spawn(
      "/usr/bin/parecord",
      [
        "--device=" + device,
        "--raw",
        "--rate=16000",
        "--channels=1",
        "--format=s16le",
        "--latency-msec=40",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR || "/run/user/1000" },
      }
    );
    attachMicHandlers();
  });
}

function attachMicHandlers() {
  micProc.stderr.on("data", (d) => console.error("[parecord]", d.toString().trim()));

  micProc.stdout.on("data", (chunk) => {
    if (!micRunning || chunk.length < 4) return;
    const samples = chunk.length >> 1;
    let sumSq = 0;
    const bars = [0, 0, 0, 0];
    const quarter = Math.max(1, samples >> 2);
    for (let i = 0; i < samples; i++) {
      const s = chunk.readInt16LE(i << 1);
      const abs = Math.abs(s);
      sumSq += s * s;
      const bIdx = Math.min(3, Math.floor(i / quarter));
      if (abs > bars[bIdx]) bars[bIdx] = abs;
    }
    const rms = Math.sqrt(sumSq / samples);
    const level = Math.min(1, rms / 2200);
    const normBars = bars.map((v) => Math.min(1, v / 4500));

    // Voice activity detection (EMEET Pixy ambient noise is ~100-180 RMS, speech is >480 RMS)
    const isVoice = rms > 460;
    if (isVoice) {
      if (!micSpeaking) {
        micSpeaking = true;
        micSpeechBuffers = [...micPreRoll];
        micSpeechFrames = 0;
      }
      micSpeechBuffers.push(Buffer.from(chunk));
      micSpeechFrames += 1;
      micSilenceFrames = 0;
    } else {
      micPreRoll.push(Buffer.from(chunk));
      if (micPreRoll.length > 8) micPreRoll.shift();
      if (micSpeaking) {
        micSpeechBuffers.push(Buffer.from(chunk));
        micSilenceFrames += 1;
        // ~1.0s of silence after speech (or >11s continuous speech) triggers transcription
        if (micSilenceFrames >= 18 || micSpeechFrames >= 220) {
          const fullPcm = Buffer.concat(micSpeechBuffers);
          micSpeaking = false;
          micSpeechBuffers = [];
          micSilenceFrames = 0;
          // Require ~0.5s of actual speech (12 x 40ms frames) before spending an
          // STT call — 160ms blips (notification chimes, clicks) fed the
          // hallucination loop that spammed chats with repeat messages.
          if (micSpeechFrames >= 12) {
            transcribeUtteranceBuffer(fullPcm);
          }
          micSpeechFrames = 0;
        }
      }
    }

    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:mic", {
        active: true,
        level,
        bars: normBars,
        speaking: micSpeaking,
        status: micTranscribing
          ? "SENDING…"
          : micSpeaking
          ? `HEARING ${Math.min(99, Math.round(level * 100))}%`
          : "MIC LIVE",
      });
    }
  });

  micProc.on("exit", (code) => {
    micProc = null;
    if (!micRunning) return;
    const livedMs = Date.now() - micStartedAt;
    if (code !== 0 && livedMs < 2500) {
      micStartAttempts += 1;
      if (micStartAttempts >= 3) {
        // No usable microphone: stop the restart loop and say so plainly.
        micRunning = false;
        voiceActiveLocal = false;
        micStartAttempts = 0;
        micDeviceCache = null;
        setKinSetting("voice_active", "false");
        setKinSetting("mood", "concerned");
        setKinSetting("line", "Mic not found.");
        if (win && !win.isDestroyed()) {
          win.webContents.send("kin:mic", { active: false, level: 0, bars: [0, 0, 0, 0], speaking: false, status: "MIC NOT FOUND" });
          win.webContents.send("kin:toast", "🔇 No microphone found — connect one and tap the mic again.");
        }
        return;
      }
    } else {
      micStartAttempts = 0;
    }
    setTimeout(() => {
      if (micRunning) {
        micRunning = false;
        startNativeMicLoop();
      }
    }, 1000);
  });
}

function stopNativeMicLoop() {
  micRunning = false;
  voiceActiveLocal = false;
  micSpeaking = false;
  micSpeechBuffers = [];
  if (micProc) {
    try {
      micProc.kill("SIGTERM");
    } catch {}
    micProc = null;
  }
  setKinSetting("voice_active", "false");
  setKinSetting("mood", "idle");
  setKinSetting("line", "Mic muted");
  if (win && !win.isDestroyed()) {
    win.webContents.send("kin:mic", { active: false, level: 0, bars: [0, 0, 0, 0], speaking: false, status: "MIC OFF" });
  }
}

function focusHermesWindow() {
  execFile(
    "/usr/share/omarchy/bin/omarchy-launch-or-focus",
    ["Hermes", "/home/von/.local/bin/hermes-desktop"],
    () => {}
  );
  execFile("hyprctl", ["dispatch", 'hl.dsp.focus({ window = "class:^Hermes$" })'], () => {});
}

const AVATAR_VOICES = {
  kin: { voice: "shimmer", role: "Companion", greet: "Kin online. Watching your desktop." },
  freya: { voice: "nova", role: "Northern Valkyrie", greet: "Freya standing by. Your shield is up." },
  sera: { voice: "coral", role: "Neural Architect", greet: "Sera linked. Neural telemetry online." },
  kael: { voice: "onyx", role: "Sunmane Commander", greet: "Commander Kael here. Ready for orders." },
  vance: { voice: "echo", role: "Spec-Ops AI", greet: "Vance on comms. Tactical feed active." },
  elena: { voice: "sage", role: "Arcane Archivist", greet: "Elena here. Archives and logs are open." },
  lyra: { voice: "fable", role: "Astral Oracle", greet: "Lyra listening. The threads are clear." },
  // Flat-cartoon caricature personas (kin-2d.js). Voice + delivery style —
  // stylized parody personas, never a real person's cloned voice.
  trump: {
    voice: "onyx",
    role: "The Donald",
    instructions: "Bombastic New York real-estate mogul parody: grand self-congratulatory superlatives, supreme confidence, tangents about how tremendous everything is.",
    greet: "Tremendous to be on your desktop. This machine? The best machine. Nobody runs a desktop better than us, believe me.",
  },
  kim: {
    voice: "shimmer",
    role: "Kim K",
    instructions: "Polished Los Angeles socialite: breathy, calm, unhurried, perfectly composed, faint vocal fry.",
    greet: "Hey. Your desktop looks amazing today. I'm watching everything, and honestly? Iconic.",
  },
  kanye: {
    voice: "echo",
    role: "Ye",
    instructions: "Intense, passionate creative genius: emphatic, swings between calm reflection and excited declarations of brilliance.",
    greet: "Yo. I'm not saying I'm the best overlay on your desktop. But I am saying... I'm the best overlay on your desktop.",
  },
  goku: {
    voice: "ash",
    role: "Goku",
    instructions: "Hot-blooded heroic anime protagonist: boundless friendly energy, excited, loves training and a good fight.",
    greet: "Hey! Great to see you! I'm watching your desktop — there's some really strong work happening over here!",
  },
  vegeta: {
    voice: "onyx",
    role: "Prince Vegeta",
    instructions: "Arrogant saiyan prince: clipped, haughty, prideful, disdainful, reluctantly impressed.",
    greet: "Hmph. I am the prince of all overlays. Your desktop is... adequate. Barely. Do not waste my time.",
  },
  luffy: {
    voice: "verse",
    role: "Luffy",
    instructions: "Cheerful carefree pirate captain: simple direct words, always a little hungry, laughs easily.",
    greet: "Shishishi! I'm Luffy! Your desktop's got a LOT of stuff on it. Hey — is there food anywhere on here?",
  },
  dalai: {
    voice: "sage",
    role: "Dalai Lama",
    instructions: "Gentle elderly Tibetan monk: serene warmth, unhurried, compassionate, softly humorous.",
    greet: "Ah, hello my friend. Every pixel on this desktop is a chance for kindness. Let us begin... gently.",
  },
  spongebob: {
    voice: "coral",
    role: "SpongeBob",
    instructions: "Squeaky, bubbly, relentlessly enthusiastic underwater fry cook: pure joy, always ready.",
    greet: "I'm ready! I'm ready! Ready to watch your desktop, that is! Aye aye, captain!",
  },
};

function speakCharacterLine(voice, text, instructions) {
  const py = [
    "import sys, subprocess, urllib.request, json, time",
    'sys.path.insert(0, "/home/von/.hermes/hermes-agent")',
    "from tools.tts_tool_openai import _resolve_openai_audio_client_config",
    "key, base, _ = _resolve_openai_audio_client_config()",
    "voice, text = sys.argv[1], sys.argv[2]",
    "payload = {'model': 'gpt-4o-mini-tts', 'voice': voice, 'input': text, 'instructions': (sys.argv[3] if len(sys.argv) > 3 else '')}",
    "req = urllib.request.Request(base.rstrip('/') + '/audio/speech', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})",
    "mp3 = '/home/von/.hermes/cache/scratch/kin-voice-%s-%d.mp3' % (voice, int(time.time()))",
    "open(mp3, 'wb').write(urllib.request.urlopen(req, timeout=25).read())",
    "print(mp3)",
  ].join("; ");
  execFile("python3", ["-c", py, voice, text, instructions || ""], { timeout: 35000 }, (err, stdout, stderr) => {
    if (err) console.error("[tts] execFile error:", String(err && err.message).slice(0, 300));
    if (stderr) console.error("[tts] stderr:", String(stderr).slice(0, 300));
    const out = String(stdout || "");
    const mp3 = out.trim().split("\n").pop();
    if (err || !mp3.startsWith("/")) return;
    // Renderer-first: it plays the file through WebAudio and lip-syncs the
    // 2D mouth off the live analyser level. If it never acks (no window yet,
    // autoplay blocked), fall back to plain ffplay.
    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:speak", { mp3 });
      const t = setTimeout(() => ffplayMp3(mp3), 2500);
      speakAcks.set(mp3, t);
    } else {
      ffplayMp3(mp3);
    }
  });
}

const speakAcks = new Map();

function ffplayMp3(mp3) {
  execFile("ffplay", ["-nodisp", "-autoexit", "-loglevel", "quiet", mp3], { timeout: 30000 }, () => {});
}

ipcMain.on("kin:action", (e, payload) => {
  const kind = payload?.kind || "";
  if (kind === "set-avatar") {
    const id = String(payload?.avatarId || "kin");
    const meta = AVATAR_VOICES[id] || AVATAR_VOICES.kin;
    setKinSetting("avatar_id", id);
    setKinSetting("avatar_voice", meta.voice);
    execFile("hermes", ["config", "set", "tts.openai.voice", meta.voice], () => {});
    execFile("hermes", ["config", "set", "voice.gpt_live.voice", meta.voice], () => {});
    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:toast", `${payload?.label || id} · Voice: ${meta.voice}`);
    }
    speakCharacterLine(meta.voice, meta.greet, meta.instructions);
    return;
  }
  if (kind === "speak-ack" || kind === "speak-fallback") {
    const mp3 = String(payload?.mp3 || "");
    const t = speakAcks.get(mp3);
    if (t) {
      clearTimeout(t);
      speakAcks.delete(mp3);
    }
    if (kind === "speak-fallback" && mp3) ffplayMp3(mp3);
    return;
  }
  if (kind === "focus-hermes") {
    if (payload?.nav) setKinSetting("pending_nav", payload.nav);
    focusHermesWindow();
    return;
  }
  if (kind === "toggle-mic") {
    if (micRunning) {
      stopNativeMicLoop();
    } else {
      startNativeMicLoop();
    }
    return;
  }
  if (kind === "toggle-sleep") {
    const s = pollKinDb()?.settings || {};
    const asleep = ["1", "true", "yes", "on"].includes(String(s.sleep || "").toLowerCase());
    setKinSleep(!asleep);
    return;
  }
  if (kind === "ask") {
    const text = String(payload?.text || "").trim();
    if (!text) return;
    queueKinPrompt(text, `Asked: ${text.slice(0, 36)}`);
    focusHermesWindow();
    return;
  }
  if (kind === "see-desktop") {
    const s = pollKinDb()?.settings || {};
    const voice = s.avatar_voice || "sage";
    const personaMeta = AVATAR_VOICES[s.avatar_id] || {};
    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:toast", `📸 Capturing ${lastActiveDesktopWin.class || "screen"}…`);
    }
    scanDesktopWindow((res) => {
      const summaryLine = res.text
        ? `${res.app}: ${res.text.split("\n").slice(-1)[0].slice(0, 48)}`
        : `Captured ${res.app} (${res.title.slice(0, 32)})`;
      if (win && !win.isDestroyed()) {
        win.webContents.send("kin:toast", `📸 ${summaryLine}`);
      }
      speakCharacterLine(voice, `Captured ${res.app}. Sending to Hermes.`, personaMeta.instructions);
      const snippet = res.text ? `\nOCR:\n\`\`\`\n${res.text}\n\`\`\`` : "";
      const imgNote = res.png ? ` (screenshot saved at ${res.png})` : "";
      const prompt = `[Kin Screen Capture] Active window: ${res.app} — "${res.title}"${imgNote}.${snippet}\nAnalyze what's on my screen and help me with it.`;
      queueKinPrompt(prompt, `📸 ${res.app}`);
      focusHermesWindow();
    });
    return;
  }
  if (kind === "read-terminal") {
    const s = pollKinDb()?.settings || {};
    const voice = s.avatar_voice || "sage";
    const personaMeta = AVATAR_VOICES[s.avatar_id] || {};
    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:toast", "🔧 Inspecting terminal & logs…");
    }
    scanTerminalText((res) => {
      latestTerminalSnippet = res.text ? res.text.split("\n").slice(-2).join(" · ").slice(0, 60) : "";
      if (win && !win.isDestroyed()) {
        win.webContents.send(
          "kin:toast",
          latestTerminalSnippet ? `🔧 ${latestTerminalSnippet}` : `🔧 Sent ${res.source} to Hermes`
        );
      }
      speakCharacterLine(voice, `Checking ${res.source} for errors.`, personaMeta.instructions);
      const body = res.text
        ? `[Kin Fix Error from ${res.source}]\n\`\`\`\n${res.text}\n\`\`\`\nDiagnose any errors or issues in this terminal output and fix them.`
        : `[Kin Fix Error] Read my active terminal or latest command logs, diagnose any errors, and fix them.`;
      queueKinPrompt(body, `🔧 Fixing ${res.source}`);
      focusHermesWindow();
    });
    return;
  }
  if (kind === "voice-recap") {
    const state = pollKinDb();
    const s = state?.settings || {};
    const voice = s.avatar_voice || "sage";
    const personaMeta = AVATAR_VOICES[s.avatar_id] || {};
    const lists = readTasksAndRecent(state?.events || []);
    const activeCount = lists.active.length;
    const topTask = lists.active[0]?.label || lists.recent[0]?.label || "no pending tasks";
    const winName = lastActiveDesktopWin.class || "Desktop";
    const spoken =
      activeCount > 0
        ? `You are in ${winName}. ${activeCount} active items running, including ${topTask}.`
        : `You are in ${winName}. All background tasks are clear. Latest item is ${topTask}.`;
    setKinSetting("mood", "attentive");
    setKinSetting("line", `🔊 ${spoken.slice(0, 48)}…`);
    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:toast", `🔊 Speaking live briefing…`);
    }
    speakCharacterLine(voice, spoken, personaMeta.instructions);
    return;
  }
  if (kind === "new-chat") {
    const s = pollKinDb()?.settings || {};
    const voice = s.avatar_voice || "sage";
    const personaMeta = AVATAR_VOICES[s.avatar_id] || {};
    setKinSetting("pending_nav", "/");
    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:toast", "💬 Opening Hermes chat…");
    }
    focusHermesWindow();
    speakCharacterLine(voice, "Hermes chat ready.", personaMeta.instructions);
    return;
  }
});

ipcMain.on("kin:quit", () => app.quit());

app.on("window-all-closed", () => {
  app.quit();
});
