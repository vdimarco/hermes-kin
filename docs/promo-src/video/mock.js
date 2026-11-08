// Stand-in for the Electron preload bridge (window.kinFloat), injected only
// into the overlay frame. The composition drives it through window.__kin.
(() => {
  if (!location.pathname.startsWith("/overlay/")) return;
  try { localStorage.setItem("kin_onboarded", "1"); } catch {}
  const L = {};
  const on = (k) => (cb) => { (L[k] = L[k] || []).push(cb); return () => {}; };
  const emit = (k, v) => (L[k] || []).forEach((cb) => { try { cb(v); } catch (e) { console.error(e); } });
  // Mirror of main.js AVATAR_VOICES (voice names only) for the switch toast.
  const VOICES = { kin: "shimmer", elena: "sage", vance: "echo", kael: "onyx", sera: "coral", freya: "nova",
    zip: "verse", juno: "alloy", sprout: "fable", ollie: "ash", barley: "ballad", mochi: "shimmer", moss: "onyx" };
  window.__kin = { emit, avatarId: "kin" };
  window.kinFloat = {
    act: (p) => {
      if (p && p.kind === "set-avatar") {
        window.__kin.avatarId = p.avatarId;
        emit("toast", `${p.label || p.avatarId} · Voice: ${VOICES[p.avatarId] || "shimmer"}`);
      }
    },
    quit() {}, sendVoice() {},
    onMicCmd: on("micCmd"), onGaze: on("gaze"), onMic: on("mic"),
    onState: on("state"), onToast: on("toast"), onSpeak: on("speak"),
  };
})();
