// Synthetic, copyright-free achievement unlock sounds via the Web Audio API.
// One short cue per rarity level (1 Bronze ... 5 Legendär -> epic fanfare).
// No audio files, no licensing concerns.

const MUTE_KEY = "tls_sound_muted";

let ctx = null;

export function isSoundMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setSoundMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? "1" : "0");
  } catch {}
}

function getCtx() {
  if (typeof window === "undefined") return null;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  if (!ctx) ctx = new AC();
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

const NOTE = { G3: 196, C4: 261.63, E4: 329.63, G4: 392, A4: 440, B4: 493.88, C5: 523.25, D5: 587.33, E5: 659.25, G5: 783.99, C6: 1046.5 };

function tone(context, master, { freq, start, dur, type = "sine", gain = 0.2, glideTo = null, attack = 0.012, release = 0.14 }) {
  const osc = context.createOscillator();
  const g = context.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, start);
  if (glideTo) osc.frequency.exponentialRampToValueAtTime(glideTo, start + dur);
  g.gain.setValueAtTime(0.0001, start);
  g.gain.exponentialRampToValueAtTime(gain, start + attack);
  g.gain.setValueAtTime(gain, start + Math.max(attack, dur - release));
  g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
  osc.connect(g);
  g.connect(master);
  osc.start(start);
  osc.stop(start + dur + 0.05);
}

function sparkle(context, master, t0, color = NOTE.C6, count = 6) {
  for (let i = 0; i < count; i++) {
    tone(context, master, {
      freq: color * (1 + i * 0.14),
      start: t0 + i * 0.045,
      dur: 0.22,
      type: "sine",
      gain: 0.06,
      attack: 0.005,
      release: 0.18,
    });
  }
}

const SEQUENCES = {
  1: (c, m, t) => {
    // Bronze: soft two-note chime
    tone(c, m, { freq: NOTE.C5, start: t, dur: 0.22, type: "triangle", gain: 0.16 });
    tone(c, m, { freq: NOTE.G5, start: t + 0.13, dur: 0.34, type: "triangle", gain: 0.16 });
  },
  2: (c, m, t) => {
    // Silber: bright ascending triad
    ["C5", "E5", "G5"].forEach((n, i) =>
      tone(c, m, { freq: NOTE[n], start: t + i * 0.1, dur: 0.32, type: "triangle", gain: 0.16 })
    );
  },
  3: (c, m, t) => {
    // Gold: quick arpeggio + shimmer
    ["G4", "C5", "E5", "G5"].forEach((n, i) =>
      tone(c, m, { freq: NOTE[n], start: t + i * 0.08, dur: 0.36, type: "sawtooth", gain: 0.1 })
    );
    ["C5", "E5", "G5"].forEach((n) =>
      tone(c, m, { freq: NOTE[n], start: t + 0.34, dur: 0.5, type: "triangle", gain: 0.09 })
    );
    sparkle(c, m, t + 0.4, NOTE.C6, 5);
  },
  4: (c, m, t) => {
    // Platin: rising sweep + shining chord
    tone(c, m, { freq: NOTE.C4, start: t, dur: 0.4, type: "sawtooth", gain: 0.09, glideTo: NOTE.C5 });
    ["G4", "C5", "E5", "G5", "C6"].forEach((n, i) =>
      tone(c, m, { freq: NOTE[n], start: t + 0.12 + i * 0.07, dur: 0.44, type: "sawtooth", gain: 0.09 })
    );
    sparkle(c, m, t + 0.5, NOTE.C6, 7);
  },
  5: (c, m, t) => {
    // Legendär: epic brass fanfare
    const brass = { type: "sawtooth", gain: 0.13 };
    // triumphant motif
    tone(c, m, { ...brass, freq: NOTE.G4, start: t, dur: 0.2 });
    tone(c, m, { ...brass, freq: NOTE.C5, start: t + 0.16, dur: 0.2 });
    tone(c, m, { ...brass, freq: NOTE.E5, start: t + 0.32, dur: 0.22 });
    tone(c, m, { ...brass, freq: NOTE.G5, start: t + 0.5, dur: 0.7 });
    // sustained power chord underneath
    [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((f) =>
      tone(c, m, { freq: f, start: t + 0.5, dur: 1.15, type: "sawtooth", gain: 0.07, release: 0.5 })
    );
    // deep foundation
    tone(c, m, { freq: NOTE.G3, start: t + 0.5, dur: 1.2, type: "sine", gain: 0.12, release: 0.55 });
    // shimmer crown
    sparkle(c, m, t + 0.62, NOTE.C6, 9);
  },
};

export function playUnlockSound(level = 1) {
  if (isSoundMuted()) return;
  const context = getCtx();
  if (!context) return;
  const lvl = Math.min(5, Math.max(1, Number(level) || 1));
  const master = context.createGain();
  master.gain.setValueAtTime(lvl >= 5 ? 0.9 : 0.75, context.currentTime);
  master.connect(context.destination);
  try {
    SEQUENCES[lvl](context, master, context.currentTime + 0.02);
  } catch {}
}
