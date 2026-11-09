// Kin Float preload — exposes gaze, live state, mic level, actions, and toast events.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("kinFloat", {
  act: (payload) => ipcRenderer.send("kin:action", payload),
  quit: () => ipcRenderer.send("kin:quit"),
  sendVoice: (buf) => ipcRenderer.send("kin:voice-utterance", buf),
  onMicCmd: (cb) => {
    ipcRenderer.on("kin:mic-cmd", (e, msg) => cb(msg));
    return () => ipcRenderer.removeAllListeners("kin:mic-cmd");
  },
  onGaze: (cb) => {
    ipcRenderer.on("kin:gaze", (e, gaze) => cb(gaze));
    return () => ipcRenderer.removeAllListeners("kin:gaze");
  },
  onMic: (cb) => {
    ipcRenderer.on("kin:mic", (e, mic) => cb(mic));
    return () => ipcRenderer.removeAllListeners("kin:mic");
  },
  onState: (cb) => {
    ipcRenderer.on("kin:state", (e, state) => cb(state));
    return () => ipcRenderer.removeAllListeners("kin:state");
  },
  onToast: (cb) => {
    ipcRenderer.on("kin:toast", (e, msg) => cb(msg));
    return () => ipcRenderer.removeAllListeners("kin:toast");
  },
  onSpeak: (cb) => {
    ipcRenderer.on("kin:speak", (e, s) => cb(s));
    return () => ipcRenderer.removeAllListeners("kin:speak");
  },
  onVoices: (cb) => {
    ipcRenderer.on("kin:voices", (e, v) => cb(v));
    return () => ipcRenderer.removeAllListeners("kin:voices");
  },
});
