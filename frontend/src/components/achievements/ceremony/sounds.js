// Erfolge II (E8, #618): Klangsets je Material (9) und je Sonderablauf (7), synthetisch über die
// Web Audio API wie bisher in lib/unlockSounds.js - keine Dateien, keine Lizenzfragen. Das Löwenbrüllen
// ist ebenfalls synthetisch (Rauschen durch Formanten mit fallender Tonhöhe), bis eine freie Datei
// mit passender Lizenz da ist. Lautstärke und „Ton aus“ kommen aus den Profileinstellungen; ohne
// Nutzergeste bleibt es still (Autoplay-Regeln).

const MUTE_KEY = "tls_sound_muted";
const VOLUME_KEY = "tls_ceremony_volume";
let sharedContext = null;

export function readSoundPrefs(user) {
  let muted = false;
  let volume = 80;
  try {
    muted = localStorage.getItem(MUTE_KEY) === "1";
    const stored = Number(localStorage.getItem(VOLUME_KEY));
    if (Number.isFinite(stored) && stored >= 0 && stored <= 100 && localStorage.getItem(VOLUME_KEY) !== null) volume = stored;
  } catch { /* privater Modus */ }
  if (user && user.ceremony_sound === false) muted = true;
  if (user && Number.isFinite(Number(user.ceremony_volume)) && user.ceremony_volume !== null && user.ceremony_volume !== undefined) volume = Math.max(0, Math.min(100, Number(user.ceremony_volume)));
  return { muted, volume };
}

export function writeSoundPrefs({ muted, volume } = {}) {
  try {
    if (muted !== undefined) localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
    if (volume !== undefined) localStorage.setItem(VOLUME_KEY, String(Math.max(0, Math.min(100, Number(volume) || 0))));
  } catch { /* egal */ }
}

export function userHasInteracted(nav = typeof navigator !== "undefined" ? navigator : null) {
  if (!nav) return true;
  const activation = nav.userActivation;
  return !activation || activation.hasBeenActive !== false;
}

export function getAudioContext(win = typeof window !== "undefined" ? window : null) {
  if (!win) return null;
  const AC = win.AudioContext || win.webkitAudioContext;
  if (!AC) return null;
  if (!sharedContext) sharedContext = new AC();
  if (sharedContext.state === "suspended" && typeof sharedContext.resume === "function") sharedContext.resume().catch?.(() => {});
  return sharedContext;
}

export function resetAudioContext() { sharedContext = null; }

const NOTE = { G2: 98, C3: 130.81, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5 };

function tone(ctx, dest, { freq, start, dur, type = "sine", gain = 0.2, glideTo = null, attack = 0.012, release = 0.14 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + attack);
  g.gain.setValueAtTime(gain, start + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(dest);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function noise(ctx, dest, { start, dur, gain = 0.2, filter = "bandpass", freq = 800, q = 1, glideTo = null }) {
  const length = Math.max(1, Math.floor(ctx.sampleRate * dur));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const biquad = ctx.createBiquadFilter();
  biquad.type = filter;
  biquad.frequency.setValueAtTime(freq, start);
  if (glideTo) biquad.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  biquad.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  src.connect(biquad);
  biquad.connect(g);
  g.connect(dest);
  src.start(start);
  src.stop(start + dur + 0.05);
}

function sparkle(ctx, dest, t0, base = NOTE.C6, count = 6, gain = 0.06) {
  for (let i = 0; i < count; i++) tone(ctx, dest, { freq: base * (1 + i * 0.14), start: t0 + i * 0.045, dur: 0.22, gain, attack: 0.005, release: 0.18 });
}

function arpeggio(ctx, dest, t0, notes, { step = 0.09, dur = 0.34, type = "triangle", gain = 0.12 } = {}) {
  notes.forEach((n, i) => tone(ctx, dest, { freq: NOTE[n] || n, start: t0 + i * step, dur, type, gain }));
}

// Das Löwenbrüllen: tiefes Rauschen mit fallender Formantfrequenz, ein Grundton darunter, kurzer Nachhall.
export function lionRoar(ctx, dest, t0, gain = 0.5) {
  noise(ctx, dest, { start: t0, dur: 1.1, gain: gain * 0.9, filter: "bandpass", freq: 520, glideTo: 140, q: 2.2 });
  noise(ctx, dest, { start: t0 + 0.05, dur: 0.9, gain: gain * 0.5, filter: "lowpass", freq: 900, glideTo: 220, q: 0.8 });
  tone(ctx, dest, { freq: 110, glideTo: 62, start: t0, dur: 1.0, type: "sawtooth", gain: gain * 0.35, attack: 0.03, release: 0.4 });
  tone(ctx, dest, { freq: 165, glideTo: 90, start: t0 + 0.02, dur: 0.8, type: "square", gain: gain * 0.12, attack: 0.03, release: 0.3 });
}

// Je Material ein Charakter: Holz klopft, Eisen klirrt, Bronze wärmt, Silber blitzt, Gold funkelt,
// Platin schwebt, Diamant klingt gläsern, Legendär hat Bläser, Geheim raunt.
export const MATERIAL_SOUNDS = {
  wood: (c, d, t) => { noise(c, d, { start: t, dur: 0.12, gain: 0.25, filter: "lowpass", freq: 700, q: 0.7 }); tone(c, d, { freq: NOTE.C5, start: t + 0.1, dur: 0.3, type: "triangle", gain: 0.12 }); },
  iron: (c, d, t) => { noise(c, d, { start: t, dur: 0.25, gain: 0.2, filter: "bandpass", freq: 2400, q: 6 }); tone(c, d, { freq: 1320, glideTo: 880, start: t, dur: 0.35, type: "square", gain: 0.06 }); },
  bronze: (c, d, t) => arpeggio(c, d, t, ["C5", "G5"], { step: 0.13, dur: 0.34, gain: 0.16 }),
  silver: (c, d, t) => arpeggio(c, d, t, ["C5", "E5", "G5"], { step: 0.1, dur: 0.32, gain: 0.16 }),
  gold: (c, d, t) => { arpeggio(c, d, t, ["G4", "C5", "E5", "G5"], { step: 0.08, dur: 0.36, type: "sawtooth", gain: 0.1 }); arpeggio(c, d, t + 0.34, ["C5", "E5", "G5"], { step: 0, dur: 0.5, gain: 0.09 }); sparkle(c, d, t + 0.4, NOTE.C6, 5); },
  platinum: (c, d, t) => { tone(c, d, { freq: NOTE.C4, glideTo: NOTE.C5, start: t, dur: 0.4, type: "sawtooth", gain: 0.09 }); arpeggio(c, d, t + 0.12, ["G4", "C5", "E5", "G5", "C6"], { step: 0.07, dur: 0.44, type: "sawtooth", gain: 0.09 }); sparkle(c, d, t + 0.5, NOTE.C6, 7); },
  diamond: (c, d, t) => { arpeggio(c, d, t, ["E5", "A5", "C6", "E6"], { step: 0.07, dur: 0.5, gain: 0.1 }); sparkle(c, d, t + 0.3, NOTE.E6, 9, 0.05); tone(c, d, { freq: NOTE.A5, start: t + 0.5, dur: 1.2, gain: 0.05, release: 0.8 }); },
  legendary: (c, d, t) => {
    const brass = { type: "sawtooth", gain: 0.13 };
    tone(c, d, { ...brass, freq: NOTE.G4, start: t, dur: 0.2 });
    tone(c, d, { ...brass, freq: NOTE.C5, start: t + 0.16, dur: 0.2 });
    tone(c, d, { ...brass, freq: NOTE.E5, start: t + 0.32, dur: 0.22 });
    tone(c, d, { ...brass, freq: NOTE.G5, start: t + 0.5, dur: 0.7 });
    [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((f) => tone(c, d, { freq: f, start: t + 0.5, dur: 1.15, type: "sawtooth", gain: 0.07, release: 0.5 }));
    tone(c, d, { freq: NOTE.G3, start: t + 0.5, dur: 1.2, gain: 0.12, release: 0.55 });
    sparkle(c, d, t + 0.62, NOTE.C6, 9);
  },
  hidden: (c, d, t) => { arpeggio(c, d, t, ["A3", "C4", "E4"], { step: 0.12, dur: 0.9, gain: 0.08 }); noise(c, d, { start: t + 0.2, dur: 0.7, gain: 0.05, filter: "bandpass", freq: 1800, glideTo: 600, q: 3 }); },
};

// Sonderabläufe: eigener Klang obendrauf.
export const SPECIAL_SOUNDS = {
  first: (c, d, t) => arpeggio(c, d, t, ["C4", "E4", "G4", "C5", "E5"], { step: 0.14, dur: 0.5, gain: 0.1 }),
  stack: (c, d, t) => { for (let i = 0; i < 3; i++) noise(c, d, { start: t + i * 0.16, dur: 0.06, gain: 0.12, filter: "highpass", freq: 3000 }); },
  group: (c, d, t) => arpeggio(c, d, t, ["C4", "D4", "E4", "F4", "G4", "A4", "B4"], { step: 0.11, dur: 0.4, gain: 0.1 }),
  category: (c, d, t) => { [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((f) => tone(c, d, { freq: f, start: t, dur: 1.6, type: "triangle", gain: 0.08, attack: 0.5, release: 0.9 })); },
  diamond: (c, d, t) => { tone(c, d, { freq: NOTE.C5, glideTo: NOTE.C6 * 2, start: t, dur: 1.2, gain: 0.06, release: 0.9 }); sparkle(c, d, t + 0.4, NOTE.E6, 12, 0.04); },
  legendary: (c, d, t) => lionRoar(c, d, t, 0.5),
  levelup: (c, d, t) => { arpeggio(c, d, t, ["G4", "A4", "B4", "C5", "D5", "E5"], { step: 0.07, dur: 0.3, gain: 0.1 }); tone(c, d, { freq: NOTE.G5, start: t + 0.45, dur: 0.8, type: "sawtooth", gain: 0.1, release: 0.5 }); noise(c, d, { start: t + 0.45, dur: 0.3, gain: 0.15, filter: "lowpass", freq: 300 }); },
};

export const MATERIAL_SOUND_KEYS = Object.freeze(Object.keys(MATERIAL_SOUNDS));
export const SPECIAL_SOUND_KEYS = Object.freeze(Object.keys(SPECIAL_SOUNDS));

/** Klang für einen Plan spielen: Material-Set, Sonderablauf danach. Gibt true zurück, wenn etwas erklang. */
export function playCeremonySound({ material, special = null }, { user = null, win, nav, force = false } = {}) {
  const prefs = readSoundPrefs(user);
  if (prefs.muted && !force) return false;
  if (!userHasInteracted(nav)) return false;
  const ctx = getAudioContext(win);
  if (!ctx) return false;
  const master = ctx.createGain();
  master.gain.setValueAtTime(Math.max(0, Math.min(1, prefs.volume / 100)) * 0.9, ctx.currentTime);
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.02;
  try {
    (MATERIAL_SOUNDS[material] || MATERIAL_SOUNDS.bronze)(ctx, master, t0);
    if (special && SPECIAL_SOUNDS[special]) SPECIAL_SOUNDS[special](ctx, master, t0 + (special === "legendary" ? 0.0 : 0.6));
  } catch { return false; }
  return true;
}
