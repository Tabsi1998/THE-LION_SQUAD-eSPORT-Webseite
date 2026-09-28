// Saison-Klänge (#679): alle Töne und die Musik entstehen live aus der Web Audio API - keine Dateien, kein Paket.
// Die Engine hier ist saisonneutral: sie wartet auf die erste Geste (Browser spielen sonst nichts), hält je einen
// Regler für Töne und Musik, spielt Instrumente einer Palette (das Saison-Modul bringt sie mit), begrenzt die Dichte,
// duckt die Musik unter Geräuschen und pausiert, wenn der Tab unsichtbar ist. Ereignisse kommen über den Bus
// `tls:season-sound` aus den Saison-Teilen (Fledermaus, Netz, Geist, Katze, Kürbis, Laterne).

export const SOUND_STORAGE_KEY = "tls-season-sound";
export const SOUND_EVENT = "tls:season-sound";
/** Zwei Töne derselben Quelle nie dichter als das - kein Geknatter bei Klicksalven. */
export const MIN_GAP_MS = 150;
/** Vorgaben: leise. Töne etwa -18 dB, Musik noch darunter. */
export const SFX_LEVEL = 0.12;
export const MUSIC_LEVEL = 0.06;
export const DUCK_LEVEL = 0.45;
export const DUCK_SECONDS = 0.9;
const GESTURES = ["pointerdown", "keydown", "touchstart"];

export function readSoundPrefs(storage = typeof localStorage === "undefined" ? null : localStorage) {
  const prefs = { sounds: true, music: true };
  try {
    const raw = storage?.getItem(SOUND_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (typeof parsed.sounds === "boolean") prefs.sounds = parsed.sounds;
      if (typeof parsed.music === "boolean") prefs.music = parsed.music;
    }
  } catch {
    // ohne Speicher gelten die Vorgaben
  }
  return prefs;
}

export function writeSoundPrefs(prefs, storage = typeof localStorage === "undefined" ? null : localStorage) {
  try {
    storage?.setItem(SOUND_STORAGE_KEY, JSON.stringify({ sounds: Boolean(prefs.sounds), music: Boolean(prefs.music) }));
  } catch {
    // dann eben nur für diese Seite
  }
}

// Die eine laufende Engine der Bühne - der Schalter im Widget spricht sie direkt an.
let activeEngine = null;

export function setActiveEngine(engine) {
  activeEngine = engine || null;
}

export function getActiveEngine() {
  return activeEngine;
}

/** Ein Saison-Teil meldet einen Klang - die Engine hört zu, wenn sie läuft. */
export function emitSound(name, params = {}, win = typeof window === "undefined" ? null : window) {
  if (!win || typeof win.dispatchEvent !== "function") return false;
  try {
    win.dispatchEvent(new CustomEvent(SOUND_EVENT, { detail: { name, ...params } }));
    return true;
  } catch {
    return false;
  }
}

/** Weißes Rauschen als Puffer - die Grundlage für Wind, Flattern, Knistern, Hauch. */
export function noiseBuffer(ctx, seconds = 1, seed = 1) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let x = seed || 1;
  for (let i = 0; i < length; i += 1) {
    // kleiner deterministischer Generator - gleich in Test und Browser
    x = (x * 1664525 + 1013904223) % 4294967296;
    data[i] = (x / 4294967296) * 2 - 1;
  }
  return buffer;
}

/**
 * Die Engine. `win`/`doc` sind nur für Tests austauschbar, `AudioContextClass` ebenso (im Browser window.AudioContext).
 * Erst `unlock()` (nach einer Geste) erzeugt den AudioContext; davor ist jedes `play` ein stilles Nein.
 */
export function createSoundEngine({ win = typeof window === "undefined" ? null : window, doc = typeof document === "undefined" ? null : document, AudioContextClass = null, prefs = null, now = () => Date.now() } = {}) {
  const Ctx = AudioContextClass || (win && (win.AudioContext || win.webkitAudioContext)) || null;
  const state = {
    ctx: null, master: null, sfx: null, musicGain: null, palette: null, music: null, prefs: prefs || readSoundPrefs(),
    unlocked: false, disposed: false, lastPlayed: new Map(), played: [],
  };

  const startMusic = () => {
    if (!state.ctx || state.music || !state.prefs.music || !state.palette?.music) return;
    try {
      state.music = state.palette.music(state.ctx, state.musicGain, { noise: noiseBuffer }) || null;
    } catch {
      state.music = null;
    }
  };
  const stopMusic = () => {
    if (!state.music) return;
    try {
      state.music.stop?.();
    } catch {
      // ein hängender Knoten ist keiner mehr
    }
    state.music = null;
  };

  const unlock = () => {
    if (state.unlocked || state.disposed || !Ctx) return false;
    try {
      state.ctx = new Ctx();
    } catch {
      return false;
    }
    state.unlocked = true;
    state.master = state.ctx.createGain();
    state.master.gain.value = 1;
    state.master.connect(state.ctx.destination);
    state.sfx = state.ctx.createGain();
    state.sfx.gain.value = state.prefs.sounds ? SFX_LEVEL : 0;
    state.sfx.connect(state.master);
    state.musicGain = state.ctx.createGain();
    state.musicGain.gain.value = MUSIC_LEVEL;
    state.musicGain.connect(state.master);
    if (state.ctx.state === "suspended" && typeof state.ctx.resume === "function") state.ctx.resume().catch?.(() => {});
    startMusic();
    return true;
  };

  const onGesture = () => {
    if (unlock()) GESTURES.forEach((name) => win?.removeEventListener(name, onGesture));
  };
  const play = (name, params = {}) => {
    if (!state.ctx || state.disposed || !state.prefs.sounds || !state.palette?.instruments?.[name]) return false;
    const stamp = now();
    const last = state.lastPlayed.get(name) || -Infinity;
    if (stamp - last < MIN_GAP_MS) return false;
    state.lastPlayed.set(name, stamp);
    try {
      state.palette.instruments[name](state.ctx, state.sfx, { ...params, noise: noiseBuffer });
    } catch {
      return false;
    }
    state.played.push(name);
    // Die Musik tritt kurz zurück, damit der Ton vorn steht.
    if (state.music && state.musicGain) {
      const t = state.ctx.currentTime;
      const gain = state.musicGain.gain;
      gain.cancelScheduledValues?.(t);
      gain.setValueAtTime(MUSIC_LEVEL * DUCK_LEVEL, t);
      gain.linearRampToValueAtTime(MUSIC_LEVEL, t + DUCK_SECONDS);
    }
    return true;
  };
  const onEvent = (event) => {
    const detail = event?.detail || {};
    if (detail.name) play(detail.name, detail);
  };
  const onVisibility = () => {
    if (!state.ctx) return;
    if (doc?.hidden) state.ctx.suspend?.();
    else state.ctx.resume?.();
  };
  if (win) {
    GESTURES.forEach((name) => win.addEventListener(name, onGesture, { passive: true }));
    win.addEventListener(SOUND_EVENT, onEvent);
  }
  doc?.addEventListener?.("visibilitychange", onVisibility);

  return {
    get unlocked() {
      return state.unlocked;
    },
    get prefs() {
      return { ...state.prefs };
    },
    get context() {
      return state.ctx;
    },
    get musicRunning() {
      return Boolean(state.music);
    },
    get played() {
      return state.played.slice();
    },
    unlock,
    play,
    setPalette(palette) {
      const changed = palette !== state.palette;
      state.palette = palette || null;
      if (changed) {
        stopMusic();
        startMusic();
      }
    },
    setPrefs(next) {
      state.prefs = { ...state.prefs, ...next };
      writeSoundPrefs(state.prefs);
      if (state.sfx) state.sfx.gain.value = state.prefs.sounds ? SFX_LEVEL : 0;
      if (state.prefs.music) startMusic();
      else stopMusic();
    },
    dispose() {
      state.disposed = true;
      stopMusic();
      if (win) {
        GESTURES.forEach((name) => win.removeEventListener(name, onGesture));
        win.removeEventListener(SOUND_EVENT, onEvent);
      }
      doc?.removeEventListener?.("visibilitychange", onVisibility);
      if (state.ctx?.close) {
        try {
          state.ctx.close();
        } catch {
          // schon zu
        }
      }
      state.ctx = null;
    },
  };
}
