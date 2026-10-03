// Erfolge II (E13, #623): die Klänge der Zeremonie in der App - dieselben Rezepte wie im Web (sounds.js): je Material
// ein Charakter (Holz klopft, Eisen klirrt, Bronze wärmt, Silber blitzt, Gold funkelt, Platin schwebt, Diamant klingt
// gläsern, Legendär hat Bläser, Geheim raunt), dazu ein Klang je Sonderablauf (erster Erfolg, Stapel, Gruppe,
// Kategorie, Diamant, Löwenbrüllen, Level). Das Web spielt sie live über die Web Audio API; die App rechnet denselben
// Klang einmal als Probenfolge vor (wie den Katzenlaut, seasons/sound/synth.ts) und spielt ihn aus dem Cache.

import * as SecureStore from "expo-secure-store";
import { playGeneratedSound } from "../../seasons/sound/player";

// 16 kHz reichen für kurze Glocken- und Bläsertöne und sparen am Handy ein Viertel der Rechnung.
export const CEREMONY_SAMPLE_RATE = 16000;
/** Version der Rechnung im Dateinamen: ändert sich ein Rezept, entsteht eine neue Datei statt der alten. */
export const CEREMONY_SOUND_VERSION = 1;

const NOTE: Record<string, number> = {
  G2: 98, C3: 130.81, G3: 196, A3: 220, C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, G4: 392, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880, C6: 1046.5, E6: 1318.5,
};

type Wave = "sine" | "triangle" | "sawtooth" | "square";
type ToneSpec = { freq: number; start: number; dur: number; type?: Wave; gain?: number; glideTo?: number | null; attack?: number; release?: number };
type NoiseSpec = { start: number; dur: number; gain?: number; filter?: "bandpass" | "lowpass" | "highpass"; freq?: number; q?: number; glideTo?: number | null };

/** Eine Mischung, in die Töne und Rauschen geschrieben werden - die Bauteile des Web-Rezepts, nur vorab gerechnet. */
export class OfflineMix {
  readonly rate: number;
  private data: Float32Array;
  private rng: () => number;

  constructor(seconds: number, rate = CEREMONY_SAMPLE_RATE, seed = 1) {
    this.rate = rate;
    this.data = new Float32Array(Math.ceil(seconds * rate));
    let state = seed >>> 0 || 1;
    // Rauschen aus einem festen Startwert: derselbe Klang ergibt dieselbe Datei.
    this.rng = () => {
      state = (state * 1664525 + 1013904223) >>> 0;
      return state / 4294967296;
    };
  }

  /**
   * Gain-Hülle wie im Web (exponentiell hinauf, halten, exponentiell hinunter auf 0,0001) - schrittweise gerechnet:
   * je Probe nur eine Multiplikation statt einer Potenz (am Handy ohne JIT spürbar schneller).
   */
  private envelope(gain: number, attack: number, hold: number, end: number) {
    const floor = 0.0001;
    const rate = this.rate;
    const up = Math.pow(gain / floor, 1 / Math.max(1, attack * rate));
    const down = Math.pow(floor / gain, 1 / Math.max(1, (end - hold) * rate));
    const attackEnd = Math.round(attack * rate);
    const holdEnd = Math.round(hold * rate);
    let value = floor;
    let index = 0;
    return () => {
      const current = index < attackEnd ? value : index < holdEnd ? gain : value;
      if (index < attackEnd) value *= up;
      else if (index === attackEnd) value = gain;
      if (index >= holdEnd) value *= down;
      index += 1;
      return current;
    };
  }

  tone({ freq, start, dur, type = "sine", gain = 0.2, glideTo = null, attack = 0.012, release = 0.14 }: ToneSpec) {
    const first = Math.max(0, Math.floor(start * this.rate));
    const last = Math.min(this.data.length, Math.ceil((start + dur) * this.rate));
    const hold = Math.max(attack, dur - release);
    const env = this.envelope(gain, attack, hold, dur);
    const glide = glideTo ? Math.pow(glideTo / freq, 1 / Math.max(1, dur * this.rate)) : 1;
    let f = freq;
    let phase = 0;
    for (let n = first; n < last; n += 1) {
      const step = f / this.rate;
      f *= glide;
      phase += step;
      if (phase >= 1) phase -= 1;
      let value: number;
      if (type === "sine") value = Math.sin(2 * Math.PI * phase);
      else if (type === "triangle") value = 1 - 4 * Math.abs(phase - 0.5);
      else if (type === "sawtooth") value = 2 * phase - 1 - blep(phase, step);
      else value = (phase < 0.5 ? 1 : -1) + blep(phase, step) - blep((phase + 0.5) % 1, step);
      this.data[n] += value * env();
    }
  }

  noise({ start, dur, gain = 0.2, filter = "bandpass", freq = 800, q = 1, glideTo = null }: NoiseSpec) {
    const first = Math.max(0, Math.floor(start * this.rate));
    const last = Math.min(this.data.length, Math.ceil((start + dur) * this.rate));
    const biquad = makeBiquad(filter, q);
    const env = this.envelope(gain, 0.02, 0.02, dur);
    const glide = glideTo ? Math.pow(glideTo / freq, 1 / Math.max(1, dur * this.rate)) : 1;
    let f = freq;
    for (let n = first; n < last; n += 1) {
      const sample = biquad(this.rng() * 2 - 1, f, this.rate);
      f *= glide;
      this.data[n] += sample * env();
    }
  }

  sparkle(t0: number, base = NOTE.C6, count = 6, gain = 0.06) {
    for (let i = 0; i < count; i += 1) this.tone({ freq: base * (1 + i * 0.14), start: t0 + i * 0.045, dur: 0.22, gain, attack: 0.005, release: 0.18 });
  }

  arpeggio(t0: number, notes: Array<string | number>, { step = 0.09, dur = 0.34, type = "triangle" as Wave, gain = 0.12 } = {}) {
    notes.forEach((note, i) => this.tone({ freq: typeof note === "number" ? note : NOTE[note], start: t0 + i * step, dur, type, gain }));
  }

  /** Das Ergebnis mit der Gesamtlautstärke des Webs (0,9) und weich begrenzt, damit nichts klirrt. */
  finish(master = 0.9): Float32Array {
    for (let n = 0; n < this.data.length; n += 1) this.data[n] = Math.tanh(this.data[n] * master);
    return this.data;
  }
}

/** Kanten des Sägezahns und des Rechtecks geglättet (PolyBLEP) - wie die bandbegrenzten Wellen des Browsers. */
function blep(phase: number, step: number): number {
  if (phase < step) {
    const t = phase / step;
    return t + t - t * t - 1;
  }
  if (phase > 1 - step) {
    const t = (phase - 1) / step;
    return t * t + t + t + 1;
  }
  return 0;
}

/**
 * Ein Biquad wie `BiquadFilterNode` (Tiefpass, Hochpass, Bandpass), dessen Frequenz gleiten darf - die Koeffizienten
 * werden nur alle 32 Proben neu gerechnet (Steuerrate wie im Browser), dazwischen gelten die letzten.
 */
function makeBiquad(kind: "bandpass" | "lowpass" | "highpass", q: number) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  let count = 0;
  let c0 = 0;
  let c1 = 0;
  let c2 = 0;
  let d1 = 0;
  let d2 = 0;
  return (input: number, frequency: number, rate: number) => {
    if (count % 32 === 0) {
      const w0 = (2 * Math.PI * Math.min(frequency, rate * 0.45)) / rate;
      const cos = Math.cos(w0);
      const alpha = Math.sin(w0) / (2 * Math.max(0.0001, q));
      let b0: number;
      let b1: number;
      let b2: number;
      if (kind === "lowpass") {
        b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = (1 - cos) / 2;
      } else if (kind === "highpass") {
        b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = (1 + cos) / 2;
      } else {
        b0 = alpha; b1 = 0; b2 = -alpha;
      }
      const a0 = 1 + alpha;
      c0 = b0 / a0; c1 = b1 / a0; c2 = b2 / a0; d1 = (-2 * cos) / a0; d2 = (1 - alpha) / a0;
    }
    count += 1;
    const output = c0 * input + c1 * x1 + c2 * x2 - d1 * y1 - d2 * y2;
    x2 = x1;
    x1 = input;
    y2 = y1;
    y1 = output;
    return output;
  };
}

/** Das Löwenbrüllen: tiefes Rauschen mit fallender Formantfrequenz, ein Grundton darunter, kurzer Nachhall. */
function lionRoar(m: OfflineMix, t0: number, gain = 0.5) {
  m.noise({ start: t0, dur: 1.1, gain: gain * 0.9, filter: "bandpass", freq: 520, glideTo: 140, q: 2.2 });
  m.noise({ start: t0 + 0.05, dur: 0.9, gain: gain * 0.5, filter: "lowpass", freq: 900, glideTo: 220, q: 0.8 });
  m.tone({ freq: 110, glideTo: 62, start: t0, dur: 1.0, type: "sawtooth", gain: gain * 0.35, attack: 0.03, release: 0.4 });
  m.tone({ freq: 165, glideTo: 90, start: t0 + 0.02, dur: 0.8, type: "square", gain: gain * 0.12, attack: 0.03, release: 0.3 });
}

export const MATERIAL_SOUNDS: Record<string, (m: OfflineMix, t: number) => void> = {
  wood: (m, t) => { m.noise({ start: t, dur: 0.12, gain: 0.25, filter: "lowpass", freq: 700, q: 0.7 }); m.tone({ freq: NOTE.C5, start: t + 0.1, dur: 0.3, type: "triangle", gain: 0.12 }); },
  iron: (m, t) => { m.noise({ start: t, dur: 0.25, gain: 0.2, filter: "bandpass", freq: 2400, q: 6 }); m.tone({ freq: 1320, glideTo: 880, start: t, dur: 0.35, type: "square", gain: 0.06 }); },
  bronze: (m, t) => m.arpeggio(t, ["C5", "G5"], { step: 0.13, dur: 0.34, gain: 0.16 }),
  silver: (m, t) => m.arpeggio(t, ["C5", "E5", "G5"], { step: 0.1, dur: 0.32, gain: 0.16 }),
  gold: (m, t) => { m.arpeggio(t, ["G4", "C5", "E5", "G5"], { step: 0.08, dur: 0.36, type: "sawtooth", gain: 0.1 }); m.arpeggio(t + 0.34, ["C5", "E5", "G5"], { step: 0, dur: 0.5, gain: 0.09 }); m.sparkle(t + 0.4, NOTE.C6, 5); },
  platinum: (m, t) => { m.tone({ freq: NOTE.C4, glideTo: NOTE.C5, start: t, dur: 0.4, type: "sawtooth", gain: 0.09 }); m.arpeggio(t + 0.12, ["G4", "C5", "E5", "G5", "C6"], { step: 0.07, dur: 0.44, type: "sawtooth", gain: 0.09 }); m.sparkle(t + 0.5, NOTE.C6, 7); },
  diamond: (m, t) => { m.arpeggio(t, ["E5", "A5", "C6", "E6"], { step: 0.07, dur: 0.5, gain: 0.1 }); m.sparkle(t + 0.3, NOTE.E6, 9, 0.05); m.tone({ freq: NOTE.A5, start: t + 0.5, dur: 1.2, gain: 0.05, release: 0.8 }); },
  legendary: (m, t) => {
    const brass = { type: "sawtooth" as Wave, gain: 0.13 };
    m.tone({ ...brass, freq: NOTE.G4, start: t, dur: 0.2 });
    m.tone({ ...brass, freq: NOTE.C5, start: t + 0.16, dur: 0.2 });
    m.tone({ ...brass, freq: NOTE.E5, start: t + 0.32, dur: 0.22 });
    m.tone({ ...brass, freq: NOTE.G5, start: t + 0.5, dur: 0.7 });
    [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((f) => m.tone({ freq: f, start: t + 0.5, dur: 1.15, type: "sawtooth", gain: 0.07, release: 0.5 }));
    m.tone({ freq: NOTE.G3, start: t + 0.5, dur: 1.2, gain: 0.12, release: 0.55 });
    m.sparkle(t + 0.62, NOTE.C6, 9);
  },
  hidden: (m, t) => { m.arpeggio(t, ["A3", "C4", "E4"], { step: 0.12, dur: 0.9, gain: 0.08 }); m.noise({ start: t + 0.2, dur: 0.7, gain: 0.05, filter: "bandpass", freq: 1800, glideTo: 600, q: 3 }); },
};

export const SPECIAL_SOUNDS: Record<string, (m: OfflineMix, t: number) => void> = {
  first: (m, t) => m.arpeggio(t, ["C4", "E4", "G4", "C5", "E5"], { step: 0.14, dur: 0.5, gain: 0.1 }),
  stack: (m, t) => { for (let i = 0; i < 3; i += 1) m.noise({ start: t + i * 0.16, dur: 0.06, gain: 0.12, filter: "highpass", freq: 3000 }); },
  group: (m, t) => m.arpeggio(t, ["C4", "D4", "E4", "F4", "G4", "A4", "B4"], { step: 0.11, dur: 0.4, gain: 0.1 }),
  category: (m, t) => { [NOTE.C4, NOTE.E4, NOTE.G4, NOTE.C5].forEach((f) => m.tone({ freq: f, start: t, dur: 1.6, type: "triangle", gain: 0.08, attack: 0.5, release: 0.9 })); },
  diamond: (m, t) => { m.tone({ freq: NOTE.C5, glideTo: NOTE.C6 * 2, start: t, dur: 1.2, gain: 0.06, release: 0.9 }); m.sparkle(t + 0.4, NOTE.E6, 12, 0.04); },
  legendary: (m, t) => lionRoar(m, t, 0.5),
  levelup: (m, t) => { m.arpeggio(t, ["G4", "A4", "B4", "C5", "D5", "E5"], { step: 0.07, dur: 0.3, gain: 0.1 }); m.tone({ freq: NOTE.G5, start: t + 0.45, dur: 0.8, type: "sawtooth", gain: 0.1, release: 0.5 }); m.noise({ start: t + 0.45, dur: 0.3, gain: 0.15, filter: "lowpass", freq: 300 }); },
};

/** Wie lange ein Klang dauert (Material plus Sonderablauf, mit Nachklang) - für die Mischung und das Aufräumen. */
export function ceremonySoundSeconds(special?: string | null): number {
  const extra = special === "category" || special === "diamond" || special === "legendary" ? 1.7 : special ? 1.2 : 0;
  return 2.0 + extra;
}

/** Ein ganzer Zeremonie-Klang: Material-Set, der Sonderablauf wie im Web kurz danach (Legendär gleich mit). */
export function renderCeremonySound({ material, special = null }: { material: string; special?: string | null }, rate = CEREMONY_SAMPLE_RATE): Float32Array {
  const mix = new OfflineMix(ceremonySoundSeconds(special), rate, hash(`${material}:${special || ""}`));
  const t0 = 0.02;
  (MATERIAL_SOUNDS[material] || MATERIAL_SOUNDS.bronze)(mix, t0);
  if (special && SPECIAL_SOUNDS[special]) SPECIAL_SOUNDS[special](mix, t0 + (special === "legendary" ? 0 : 0.6));
  return mix.finish();
}

// ------------------------------------------------------------------ Einstellungen und Abspielen

const MUTE_KEY = "ceremony_sound_muted";
let mutedOnDevice: boolean | null = null;

type SoundUser = { ceremony_sound?: boolean | null; ceremony_volume?: number | null } | null | undefined;

/** Wie im Web: „Ton aus“ am Gerät oder im Profil schaltet stumm, die Lautstärke (0–100, Vorgabe 80) kommt aus dem Profil. */
export async function readCeremonySoundPrefs(user?: SoundUser): Promise<{ muted: boolean; volume: number }> {
  if (mutedOnDevice === null) {
    try {
      mutedOnDevice = (await SecureStore.getItemAsync(MUTE_KEY)) === "1";
    } catch {
      mutedOnDevice = false;
    }
  }
  let volume = 80;
  if (user && user.ceremony_volume !== null && user.ceremony_volume !== undefined && Number.isFinite(Number(user.ceremony_volume))) {
    volume = Math.max(0, Math.min(100, Number(user.ceremony_volume)));
  }
  return { muted: Boolean(mutedOnDevice) || user?.ceremony_sound === false, volume };
}

export async function writeCeremonyMuted(muted: boolean): Promise<void> {
  mutedOnDevice = muted;
  try {
    await SecureStore.setItemAsync(MUTE_KEY, muted ? "1" : "0");
  } catch {
    // Dann gilt die Wahl bis zum nächsten Start.
  }
}

/** Nur für Tests. */
export function resetCeremonySoundPrefs(): void {
  mutedOnDevice = null;
}

/** Den Klang einer Zeremonie spielen - `force` auch bei „Ton aus“ (der Schalter in der Zeremonie spielt ihn zur Probe). */
export async function playCeremonySound(sound: { material: string; special?: string | null }, { user, force = false }: { user?: SoundUser; force?: boolean } = {}): Promise<boolean> {
  const prefs = await readCeremonySoundPrefs(user);
  if (prefs.muted && !force) return false;
  if (prefs.volume <= 0) return false;
  const name = `ceremony-${sound.material}-${sound.special || "none"}-v${CEREMONY_SOUND_VERSION}`;
  return playGeneratedSound(name, ceremonySoundSeconds(sound.special), () => renderCeremonySound(sound), { volume: prefs.volume / 100 });
}

function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
