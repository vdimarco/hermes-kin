// Kin Float — floating companion HUD for Omarchy/Hyprland.
const { app, BrowserWindow, ipcMain, screen, session } = require("electron");
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

// Screenshot a screen region, per platform. cb(outPath) or cb("").
function captureRegion(geom, outPath, cb) {
  if (process.platform === "linux") {
    execFile("grim", ["-g", geom, outPath], { timeout: 2500 }, (err) => cb(err ? "" : outPath));
    return;
  }
  if (process.platform === "darwin") {
    // geom is "x,y WxH"
    const [origin, size] = geom.split(" ");
    execFile(
      "screencapture",
      ["-x", `-R${origin.replace(",", ",")},${size.replace("x", ",")}`, outPath],
      { timeout: 3000 },
      (err) => cb(err ? "" : outPath)
    );
    return;
  }
  if (process.platform === "win32") {
    const [origin, size] = geom.split(" ");
    const [x, y] = origin.split(",").map(Number);
    const [w, h] = size.split("x").map(Number);
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        `Add-Type -AssemblyName System.Drawing; $b = New-Object System.Drawing.Bitmap ${w}, ${h}; $g = [System.Drawing.Graphics]::FromImage($b); $g.CopyFromScreen(${x}, ${y}, 0, 0, $b.Size); $b.Save('${outPath.replace(/\\/g, "\\\\")}'); $g.Dispose(); $b.Dispose()`,
      ],
      { timeout: 3500 },
      (err) => cb(err ? "" : outPath)
    );
    return;
  }
  cb("");
}

function scratchDir() {
  const d = path.join(os.homedir(), ".hermes", "cache", "scratch");
  try { fs.mkdirSync(d, { recursive: true }); } catch {}
  return d;
}

function captureAndOcrGeometry(geom, outBase, cb) {
  const png = path.join(scratchDir(), `${outBase}.png`);
  captureRegion(geom, png, (pathOut) => {
    if (!pathOut) return cb("", "");
    // OCR is optional: tesseract when installed (any platform), otherwise
    // the prompt still references the saved screenshot for Hermes's vision.
    execFile("tesseract", [png, "stdout", "--psm", "6"], { timeout: 4000 }, (err2, stdout) => {
      if (err2) return cb("", png);
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

// Active desktop window, per platform. cb receives {class, title, at, size}
// or null. Linux uses the Hyprland socket; macOS uses System Events; Windows
// uses a small PowerShell Add-Type probe. All are optional — Snap falls back
// to the last known window.
function getActiveWindow(cb) {
  if (process.platform === "linux" && HYPR_SOCK) {
    hyprSocketCmd("j/activewindow", (stdout) => {
      if (!stdout) return cb(null);
      try {
        const active = JSON.parse(stdout);
        if (active && active.class && active.class !== "kin-float") {
          return cb({
            class: active.class,
            title: active.title || active.class,
            at: active.at || [0, 0],
            size: active.size || [1920, 1080],
          });
        }
      } catch {}
      cb(null);
    });
    return;
  }
  if (process.platform === "darwin") {
    execFile(
      "osascript",
      [
        "-e",
        'tell application "System Events" to tell (first process whose frontmost is true) to get {name, name of front window, position of front window, size of front window}',
      ],
      { timeout: 2000 },
      (err, stdout) => {
        if (err) return cb(null);
        const parts = String(stdout || "").split(", ").map((s) => s.trim());
        if (parts.length < 4) return cb(null);
        const name = parts[0];
        if (name === "kin-float" || name === "Electron") return cb(null);
        cb({
          class: name,
          title: parts[1] === "missing value" ? name : parts[1],
          at: [Number(parts[2]) || 0, Number(parts[3]) || 0],
          size: [Number(parts[4]) || 1920, Number(parts[5]) || 1080],
        });
      }
    );
    return;
  }
  if (process.platform === "win32") {
    execFile(
      "powershell",
      [
        "-NoProfile",
        "-Command",
        "Add-Type @'\nusing System;using System.Runtime.InteropServices;using System.Text;\npublic class W { [DllImport(\"user32.dll\")] public static extern IntPtr GetForegroundWindow(); [DllImport(\"user32.dll\")] public static extern bool GetWindowRect(IntPtr h, out R r); [DllImport(\"user32.dll\")] public static extern int GetWindowText(IntPtr h, StringBuilder s, int n); public struct R { public int L, T, Rt, B; } }\n'@\n$h=[W]::GetForegroundWindow(); if ($h -eq [IntPtr]::Zero) { '' } else { $r = New-Object W+R; [W]::GetWindowRect($h, [ref]$r) | Out-Null; $sb = New-Object System.Text.StringBuilder 512; [W]::GetWindowText($h, $sb, 512) | Out-Null; \"$($r.L),$($r.T),$($r.Rt),$($r.B),$($sb.ToString())\" }",
      ],
      { timeout: 2500 },
      (err, stdout) => {
        if (err) return cb(null);
        const parts = String(stdout || "").trim().split(",");
        if (parts.length < 5) return cb(null);
        const title = parts.slice(4).join(",");
        if (!title || title === "kin-float") return cb(null);
        cb({
          class: title.split(" - ").pop() || title,
          title,
          at: [Number(parts[0]) || 0, Number(parts[1]) || 0],
          size: [Math.max(50, (Number(parts[2]) || 1920) - (Number(parts[0]) || 0)), Math.max(50, (Number(parts[3]) || 1080) - (Number(parts[1]) || 0))],
        });
      }
    );
    return;
  }
  cb(null);
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

  // 1. Gaze follows the global cursor — Electron's screen API works the same
  //    on Linux, macOS and Windows (no Hyprland socket, no spawns).
  let pollingCursor = false;
  setInterval(() => {
    if (!win || win.isDestroyed() || pollingCursor) return;
    pollingCursor = true;
    try {
      const pt = screen.getCursorScreenPoint();
      const cx = pt.x;
      const cy = pt.y;
      // Anchor gaze at the overlay's own on-screen position so the avatar
      // tracks correctly on any monitor size or position — never a fixed point.
      const [winX, winY] = win.getPosition();
      const [winW, winH] = win.getContentSize();
      const refX = winX + winW / 2;
      const refY = winY + Math.min(150, winH * 0.28);
      const dx = Math.max(-1, Math.min(1, (cx - refX) / 900));
      const dy = Math.max(-1, Math.min(1, (cy - refY) / 500));
      win.webContents.send("kin:gaze", { dx, dy });
    } catch {}
    pollingCursor = false;
  }, 25);

  // 2. Watch the active desktop window (platform-aware)
  setInterval(() => {
    if (!win || win.isDestroyed()) return;
    getActiveWindow((active) => {
      if (!active) return;
      lastActiveDesktopWin = active;
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

// Mic state lives in the renderer (getUserMedia); main only tracks
// whether it is on and whether an STT call is in flight.
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
  const wavPath = path.join(scratchDir(), `kin-utt-${Date.now()}.wav`);
  try {
    writePcmWav(wavPath, pcmBuffer, 16000);
  } catch {
    micTranscribing = false;
    return;
  }
  if (micRunning && win && !win.isDestroyed()) {
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
      'import os; sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))',
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

// ---- Mic (renderer getUserMedia engine — cross-platform) ----
// Audio capture runs in the renderer via getUserMedia, which works the same
// on Linux, macOS and Windows (with each OS's own permission prompt). The
// renderer runs the VAD and ships completed 16 kHz utterances here as PCM.

let micRunning = false;

function startMic() {
  micRunning = true;
  voiceActiveLocal = true;
  setKinSetting("voice_active", "true");
  setKinSetting("mood", "attentive");
  setKinSetting("line", "🎙 Mic Live · Speak anytime");
  if (win && !win.isDestroyed()) {
    win.webContents.send("kin:mic-cmd", { action: "start" });
  }
}

function stopMic(notifyUi = true) {
  micRunning = false;
  voiceActiveLocal = false;
  setKinSetting("voice_active", "false");
  setKinSetting("mood", "idle");
  setKinSetting("line", "Mic muted");
  if (notifyUi && win && !win.isDestroyed()) {
    win.webContents.send("kin:mic-cmd", { action: "stop" });
  }
}

ipcMain.on("kin:voice-utterance", (_e, pcmBuffer) => {
  try {
    if (!pcmBuffer || !pcmBuffer.byteLength) return;
    transcribeUtteranceBuffer(Buffer.from(pcmBuffer));
  } catch (err) {
    console.error("[voice] utterance error:", err);
  }
});


function focusHermesWindow() {
  if (process.platform === "linux") {
    execFile(
      "/usr/share/omarchy/bin/omarchy-launch-or-focus",
      ["Hermes", path.join(os.homedir(), ".local", "bin", "hermes-desktop")],
      () => {}
    );
    execFile("hyprctl", ["dispatch", 'hl.dsp.focus({ window = "class:^Hermes$" })'], () => {});
    return;
  }
  if (process.platform === "darwin") {
    execFile("open", ["-a", "Hermes"], () => {});
    return;
  }
  if (process.platform === "win32") {
    execFile("powershell", ["-NoProfile", "-Command",
      "$p = Get-Process | Where-Object { $_.MainWindowTitle -and $_.Name -eq 'Hermes' } | Select-Object -First 1; if ($p) { Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.Interaction]::AppActivate($p.Id) | Out-Null }"], () => {});
  }
}

const AVATAR_VOICES = {
  kin: { voice: "shimmer", role: "Companion", greet: "Kin online. Watching your desktop." },
  freya: { voice: "nova", role: "Northern Valkyrie", greet: "Freya standing by. Your shield is up." },
  sera: { voice: "coral", role: "Neural Architect", greet: "Sera linked. Neural telemetry online." },
  kael: { voice: "onyx", role: "Sunmane Commander", greet: "Commander Kael here. Ready for orders." },
  vance: { voice: "echo", role: "Spec-Ops AI", greet: "Vance on comms. Tactical feed active." },
  elena: { voice: "sage", role: "Arcane Archivist", greet: "Elena here. Archives and logs are open." },
  // Cartoon personas (2D portraits).
  zip: { voice: "verse", role: "Systems Sidekick", greet: "Zip online. Your builds are in good hands.", instructions: "Cheerful little robot sidekick: bright, quick, upbeat." },
  juno: { voice: "alloy", role: "Focus Coach", greet: "Juno here. Let's get you unstuck.", instructions: "Confident focus coach: warm, direct, encouraging." },
  sprout: { voice: "fable", role: "Curious Helper", greet: "Sprout's awake! What are we building?", instructions: "Excited baby dragon: curious, bouncy, eager." },
  ollie: { voice: "ash", role: "Captain of the Queue", greet: "Captain Ollie. All tasks on deck.", instructions: "Jolly octopus ship captain: hearty, playful." },
  barley: { voice: "ballad", role: "Calm Keeper", greet: "Barley here. Coffee's on. Take your time.", instructions: "Calm bear: slow, warm, steady." },
  mochi: { voice: "shimmer", role: "Quiet-Hours Guard", greet: "Mochi's on watch. Rest easy.", instructions: "Sleepy soft creature: gentle, hushed, soothing." },
  moss: { voice: "onyx", role: "Chill Navigator", greet: "Moss here. No rush. We'll get there.", instructions: "Laid-back sloth: slow, mellow, unbothered, a little amused." },
};

function speakCharacterLine(voice, text, instructions) {
  const py = [
    "import sys, subprocess, urllib.request, json, time",
    'import os; sys.path.insert(0, os.path.expanduser("~/.hermes/hermes-agent"))',
    "from tools.tts_tool_openai import _resolve_openai_audio_client_config",
    "key, base, _ = _resolve_openai_audio_client_config()",
    "voice, text = sys.argv[1], sys.argv[2]",
    "payload = {'model': 'gpt-4o-mini-tts', 'voice': voice, 'input': text, 'instructions': (sys.argv[3] if len(sys.argv) > 3 else '')}",
    "req = urllib.request.Request(base.rstrip('/') + '/audio/speech', data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})",
    "import pathlib; mp3 = str(pathlib.Path.home() / '.hermes' / 'cache' / 'scratch' / ('kin-voice-%s-%d.mp3' % (voice, int(time.time()))))",
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
      stopMic();
    } else {
      startMic();
    }
    return;
  }
  if (kind === "mic-failed") {
    // Renderer could not open the microphone (denied or none available).
    stopMic(false);
    setKinSetting("mood", "concerned");
    setKinSetting("line", "Mic not found.");
    if (win && !win.isDestroyed()) {
      win.webContents.send("kin:toast", "🔇 No microphone available — connect one and tap the mic again.");
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
