// Ambient loops (SoundMixer.swift) on Web Audio: one looping
// AudioBufferSourceNode per sound, each through its own GainNode. Sound plays
// only while focusing (or on a break when allowed). Browsers only start audio
// from a user gesture, so until unlock() runs the mixer just remembers the
// requested phase (PLAN S1, S2).
import { h, openSheet as uiOpenSheet, toast } from "./ui.js";
import { SOUNDS } from "./catalog.js";

const WRITE_INTERVAL = 150;

export function createMixer({ store }) {
  let audio = null; // AudioContext, created on the first unlock()
  let lastPhase = "idle";
  const buffers = new Map(); // id -> AudioBuffer | null (null = missing/undecodable)
  const loading = new Map(); // id -> Promise
  const voices = new Map(); // id -> { source, gain }
  // Slider values not written to the store yet; they win over stored volumes.
  // Each edit carries a version, so an edit is sent at most once and an
  // older in-flight write never replaces a newer edit (from this tab).
  const pending = {}; // id -> { value, version }
  const sent = {}; // id -> version already handed to a store write
  let editVersion = 0;
  let failedWrites = 0;
  const MAX_RETRIES = 3;
  let heldChimeAt = 0;
  let flushTimer = null;

  function pendingVolumes() {
    return Object.fromEntries(Object.entries(pending).map(([id, edit]) => [id, edit.value]));
  }

  function soundState() {
    const stored = store.read("sound");
    return { ...stored, volumes: { ...stored.volumes, ...pendingVolumes() } };
  }

  function wants(phase, sound) {
    return phase === "focusing" || (phase === "breaking" && Boolean(sound.playDuringBreak));
  }

  function load(id) {
    if (buffers.has(id)) return Promise.resolve(buffers.get(id));
    if (loading.has(id)) return loading.get(id);
    const ctx = audio;
    const promise = fetch(`assets/${id}.wav`)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.arrayBuffer();
      })
      .then((data) => new Promise((resolve, reject) => {
        // Callback form too, for older Safari.
        const result = ctx.decodeAudioData(data, resolve, reject);
        if (result && typeof result.then === "function") result.then(resolve, reject);
      }))
      .catch((error) => {
        console.warn(`sound ${id} unavailable`, error);
        return null;
      })
      .then((buffer) => {
        buffers.set(id, buffer);
        loading.delete(id);
        return buffer;
      });
    loading.set(id, promise);
    return promise;
  }

  function stopVoice(id) {
    const voice = voices.get(id);
    if (!voice) return;
    voices.delete(id);
    try { voice.source.stop(); } catch { /* already stopped */ }
    try { voice.source.disconnect(); voice.gain.disconnect(); } catch { /* ignore */ }
  }

  function startVoice(id, buffer, volume) {
    const gain = audio.createGain();
    gain.gain.value = volume;
    gain.connect(audio.destination);
    const source = audio.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    source.connect(gain);
    source.start();
    voices.set(id, { source, gain });
  }

  function setGain(voice, volume) {
    const param = voice.gain.gain;
    try {
      param.cancelScheduledValues(audio.currentTime);
      param.setTargetAtTime(volume, audio.currentTime, 0.015);
    } catch {
      param.value = volume;
    }
  }

  /** Applies the phase to one sound; re-checks the live state after a load. */
  function apply(id) {
    const sound = soundState();
    const volume = Number(sound.volumes[id]) || 0;
    const on = wants(lastPhase, sound) && volume > 0;
    if (!on) {
      stopVoice(id);
      return;
    }
    const voice = voices.get(id);
    if (voice) {
      setGain(voice, volume);
      return;
    }
    if (buffers.has(id)) {
      const buffer = buffers.get(id);
      if (buffer) startVoice(id, buffer, volume);
      return;
    }
    load(id).then(() => {
      if (!voices.has(id) && buffers.get(id)) {
        try { apply(id); } catch (error) { console.warn("sound sync", error); }
      }
    });
  }

  function sync(phase) {
    if (typeof phase === "string") lastPhase = phase;
    if (!audio) return;
    try {
      for (const { id } of SOUNDS) apply(id);
    } catch (error) {
      console.warn("sound sync", error);
    }
  }

  async function unlock() {
    try {
      if (!audio) {
        // Before the context exists, so the silent switch is respected.
        try {
          if (navigator.audioSession) navigator.audioSession.type = "ambient";
        } catch { /* unsupported */ }
        const Ctor = window.AudioContext || window.webkitAudioContext;
        if (!Ctor) return;
        audio = new Ctor();
        audio.addEventListener("statechange", () => {
          sync();
          deliverHeldChime();
        });
      }
      let resumed = null;
      if (audio.state !== "running") {
        try {
          if (navigator.audioSession) navigator.audioSession.type = "ambient";
        } catch { /* unsupported */ }
        resumed = audio.resume();
      }
      sync();
      if (resumed) await resumed.catch((error) => console.warn("audio resume", error));
      sync();
      // A completion that happened before audio was allowed still chimes,
      // if the tap comes within a minute.
      deliverHeldChime();
    } catch (error) {
      console.warn("audio unlock", error);
    }
  }

  // Any ordinary tap or key press on the page counts as the gesture Safari
  // needs, so a restored session gets its sound (and completion chime) back
  // as soon as the user touches the app at all.
  for (const type of ["pointerdown", "touchend", "click", "keydown"]) {
    document.addEventListener(type, () => {
      if (!audio || audio.state !== "running") unlock();
    }, { capture: true, passive: true });
  }

  /**
   * Whether audio is waiting for a tap: "loops" when ambient sound should be
   * playing, "chime" while focusing (so the completion chime can play),
   * otherwise false.
   */
  function needsTap(phase = lastPhase) {
    if (audio && audio.state === "running") return false;
    const sound = soundState();
    if (wants(phase, sound) && SOUNDS.some(({ id }) => Number(sound.volumes[id]) > 0)) return "loops";
    return phase === "focusing" ? "chime" : false;
  }

  // ---- volume writes (throttled) ----
  function currentGen() {
    return store.read("session").importGen ?? null;
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    // Only edits newer than what is already on its way to the store.
    const batch = Object.entries(pending).filter(([id, edit]) => edit.version > (sent[id] ?? 0));
    if (batch.length === 0) return Promise.resolve();
    for (const [id, edit] of batch) sent[id] = edit.version;
    // Each edit is applied only if it was made in the stored import
    // generation; checked edit by edit, inside the lock.
    return store.transactMany(["sound", "session"], ({ sound, session }) => {
      const gen = session.importGen ?? null;
      const current = batch.filter(([, edit]) => edit.gen === gen);
      if (current.length === 0) return { values: {}, result: false };
      const volumes = Object.fromEntries(current.map(([id, edit]) => [id, edit.value]));
      return { values: { sound: { ...sound, volumes: { ...sound.volumes, ...volumes } } }, result: current.length === batch.length };
    })
      .then((applied) => {
        for (const [id, edit] of batch) {
          if (pending[id]?.version === edit.version) delete pending[id];
        }
        if (!applied) sync(); // an import replaced the settings: its volumes apply
      })
      .then(() => { failedWrites = 0; })
      .catch((error) => {
        console.error(error);
        failedWrites += 1;
        if (failedWrites <= MAX_RETRIES) {
          // Send the failed edits again (unless a newer edit replaced them).
          for (const [id, edit] of batch) {
            if (sent[id] === edit.version) sent[id] = edit.version - 1;
          }
          if (!flushTimer) flushTimer = setTimeout(flush, 500 * failedWrites);
        } else {
          // Give up: drop the unsaved values so the stored volumes apply again.
          failedWrites = 0;
          for (const [id, edit] of batch) {
            if (pending[id]?.version === edit.version) delete pending[id];
          }
          toast("音量設定無法儲存", { error: true });
          sync();
        }
      });
  }

  function setVolume(id, value) {
    dropStaleEdits(); // an import may have landed before its storage event
    pending[id] = { value: Math.min(1, Math.max(0, value)), version: ++editVersion, gen: currentGen() };
    sync(); // the gain follows the slider at once
    if (!flushTimer) flushTimer = setTimeout(flush, WRITE_INTERVAL);
  }

  function openSheet() {
    const sound = soundState();
    const sliders = new Map();
    const list = h("div", { class: "group-body" }, ...SOUNDS.map(({ id, title }) => {
      const slider = h("input", {
        class: "snd-slider",
        type: "range",
        min: "0",
        max: "1",
        step: "0.01",
        value: String(sound.volumes[id] ?? 0),
        attrs: { "aria-label": `${title}音量` },
      });
      slider.addEventListener("input", () => {
        unlock();
        setVolume(id, Number(slider.value));
      });
      slider.addEventListener("change", () => flush());
      sliders.set(id, slider);
      return h("label", { class: "row snd-row" },
        h("span", { class: "snd-label", text: title }),
        slider);
    }));

    const toggle = h("input", { type: "checkbox", class: "snd-check", checked: Boolean(sound.playDuringBreak) });
    toggle.addEventListener("change", () => {
      unlock();
      const value = toggle.checked;
      store.update("sound", (s) => ({ ...s, playDuringBreak: value })).catch((error) => console.error(error));
    });

    const content = h("div", { class: "snd-sheet" },
      h("div", { class: "group" }, list,
        h("p", { class: "muted small-text snd-footer", text: "聲音只在專注時播放；重新開啟 app 後需要點一下才能恢復聲音。" })),
      h("div", { class: "group" }, h("div", { class: "group-body" },
        h("label", { class: "row snd-row snd-toggle-row" }, h("span", { class: "grow", text: "休息時也播放" }), toggle))),
    );

    // Reflect changes made in another tab, without fighting the user's drag.
    const unsubscribe = store.subscribe(() => {
      const fresh = soundState();
      for (const [id, slider] of sliders) {
        if (!(id in pending) && document.activeElement !== slider) slider.value = String(fresh.volumes[id] ?? 0);
      }
      if (document.activeElement !== toggle) toggle.checked = Boolean(fresh.playDuringBreak);
    });

    uiOpenSheet({
      title: "白噪音",
      content,
      onClose: () => {
        unsubscribe();
        flush();
      },
    });
  }

  // After an import (in any tab), unsaved edits from an earlier generation
  // belong to replaced data: drop those, keep edits made since.
  function dropStaleEdits() {
    const gen = currentGen();
    for (const [id, edit] of Object.entries(pending)) {
      if (edit.gen !== gen) {
        delete pending[id];
        delete sent[id];
      }
    }
  }
  store.subscribe(() => {
    dropStaleEdits();
    sync();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden || !audio) return;
    if (audio.state !== "running") audio.resume().catch(() => {});
    sync();
    deliverHeldChime();
  });

  /** Plays a chime held while audio was locked, if it is still recent. */
  function deliverHeldChime() {
    if (!heldChimeAt || !audio || audio.state !== "running" || document.hidden) return;
    const recent = Date.now() - heldChimeAt < 60_000;
    heldChimeAt = 0;
    if (recent) chime();
  }

  /**
   * A short two-note bell when a session completes while the page is visible.
   * Synthesized (no file); plays only if audio was unlocked by a gesture
   * earlier (pressing Start does that), at a fixed modest level.
   */
  function chime() {
    if (document.hidden) return;
    if (!audio || audio.state !== "running") {
      heldChimeAt = Date.now(); // played by the next unlock, if soon
      return;
    }
    try {
      const t0 = audio.currentTime + 0.02;
      [[880, 0], [1318.5, 0.18]].forEach(([freq, delay]) => {
        const osc = audio.createOscillator();
        const gain = audio.createGain();
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, t0 + delay);
        gain.gain.exponentialRampToValueAtTime(0.25, t0 + delay + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + delay + 1.2);
        osc.connect(gain).connect(audio.destination);
        osc.start(t0 + delay);
        osc.stop(t0 + delay + 1.25);
      });
    } catch (error) {
      console.warn("chime", error);
    }
  }

  return { sync, unlock, needsTap, openSheet, chime };
}
