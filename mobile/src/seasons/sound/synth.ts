// Klänge der Saison-Deko in der App (#772, Web #679/#768): wie im Web live erzeugt, ohne Dateien im Paket. Das Web
// rechnet mit der Web Audio API im Augenblick; die App rechnet denselben Laut einmal als Zahlenreihe vor
// (`renderMeow`), legt ihn als WAV in den Cache und spielt ihn von dort. Reine Rechnung - testbar ohne Gerät.

export const SAMPLE_RATE = 22050;

/** Drei Arten zu miauen wie im Web (`halloween/sounds.js`): kurz und hell, gewöhnlich, lang und dunkel. */
export const MEOWS = [
  { pitch: 1.18, seconds: 0.42, peak: 0.26 },
  { pitch: 1, seconds: 0.58, peak: 0.3 },
  { pitch: 0.86, seconds: 0.78, peak: 0.3 },
] as const;

export type Meow = { pitch: number; seconds: number; peak: number };

/** Welche Art: wie im Web 30 % hell, 45 % gewöhnlich, 25 % dunkel. */
export function pickMeow(roll: number): number {
  return roll < 0.3 ? 0 : roll < 0.75 ? 1 : 2;
}

/** So laut wird der lauteste Punkt des Lauts (von 1) - leise, aber am Handy hörbar. Die Arten behalten ihr Verhältnis. */
export const MEOW_LEVEL = 0.32;

type Point = { at: number; value: number; curve?: "linear" | "exp" };

/**
 * Ein Verlauf wie `AudioParam` im Web: Startwert, dann linear oder exponentiell zum nächsten Punkt; nach dem letzten
 * Punkt bleibt der Wert stehen.
 */
export function ramp(points: Point[], t: number): number {
  if (t <= points[0].at) return points[0].value;
  for (let n = 1; n < points.length; n += 1) {
    const from = points[n - 1];
    const to = points[n];
    if (t <= to.at) {
      const share = (t - from.at) / Math.max(1e-9, to.at - from.at);
      return to.curve === "exp" ? from.value * Math.pow(to.value / from.value, share) : from.value + (to.value - from.value) * share;
    }
  }
  return points[points.length - 1].value;
}

/** Sägezahn ohne harte Kanten (PolyBLEP) - wie der bandbegrenzte Sägezahn des Browsers, ohne Klirren. */
function polyBlep(phase: number, step: number): number {
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

/** Ein Bandpass wie `BiquadFilterNode` „bandpass“ (konstante Spitze 0 dB), dessen Mitte sich je Probe bewegen darf. */
function bandpass(q: number) {
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  return (input: number, frequency: number, sampleRate: number) => {
    const w0 = (2 * Math.PI * Math.min(frequency, sampleRate * 0.45)) / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const a0 = 1 + alpha;
    const b0 = alpha / a0;
    const b2 = -alpha / a0;
    const a1 = (-2 * Math.cos(w0)) / a0;
    const a2 = (1 - alpha) / a0;
    const output = b0 * input + b2 * x2 - a1 * y1 - a2 * y2;
    x2 = x1;
    x1 = input;
    y2 = y1;
    y1 = output;
    return output;
  };
}

/**
 * Der Laut der Katze - dieselbe Bauart wie im Web: ein Sägezahn gleitet hinauf und fällt wieder, mit leichtem Vibrato,
 * durch zwei wandernde Formanten („mi-a-u“). Am Ende auf `MEOW_LEVEL` gebracht, die Arten im Verhältnis ihres `peak`.
 */
export function renderMeow(meow: Meow, sampleRate: number = SAMPLE_RATE): Float32Array {
  const { pitch, seconds, peak } = meow;
  const total = Math.round((seconds + 0.05) * sampleRate);
  const out = new Float32Array(total);
  const voice: Point[] = [
    { at: 0, value: 430 * pitch },
    { at: seconds * 0.28, value: 640 * pitch },
    { at: seconds, value: 360 * pitch, curve: "exp" },
  ];
  const firstFormant: Point[] = [
    { at: 0, value: 420 },
    { at: seconds * 0.35, value: 950 },
    { at: seconds, value: 480, curve: "exp" },
  ];
  const secondFormant: Point[] = [
    { at: 0, value: 2300 },
    { at: seconds * 0.45, value: 1500, curve: "exp" },
    { at: seconds, value: 900, curve: "exp" },
  ];
  const gain: Point[] = [
    { at: 0, value: 0.0001 },
    { at: 0.07, value: peak },
    { at: seconds * 0.6, value: peak * 0.8 },
    { at: seconds, value: 0.0001, curve: "exp" },
  ];
  const first = bandpass(5);
  const second = bandpass(7);
  let phase = 0;
  let loudest = 0;
  for (let n = 0; n < total; n += 1) {
    const t = n / sampleRate;
    const frequency = ramp(voice, t) + 9 * pitch * Math.sin(2 * Math.PI * 6.5 * t);
    const step = frequency / sampleRate;
    phase += step;
    if (phase >= 1) phase -= 1;
    const saw = 2 * phase - 1 - polyBlep(phase, step);
    const sound = first(saw, ramp(firstFormant, t), sampleRate) + 0.55 * second(saw, ramp(secondFormant, t), sampleRate);
    const value = sound * ramp(gain, t);
    out[n] = value;
    loudest = Math.max(loudest, Math.abs(value));
  }
  const scale = loudest > 0 ? (MEOW_LEVEL * (peak / 0.3)) / loudest : 0;
  for (let n = 0; n < total; n += 1) out[n] *= scale;
  return out;
}

/** Eine WAV-Datei (16 Bit, mono) aus Proben zwischen -1 und 1. */
export function encodeWav(samples: Float32Array, sampleRate: number = SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);
  const text = (offset: number, value: string) => {
    for (let n = 0; n < value.length; n += 1) bytes[offset + n] = value.charCodeAt(n);
  };
  text(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  text(8, "WAVE");
  text(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  text(36, "data");
  view.setUint32(40, samples.length * 2, true);
  for (let n = 0; n < samples.length; n += 1) {
    const value = Math.max(-1, Math.min(1, samples[n]));
    view.setInt16(44 + n * 2, Math.round(value < 0 ? value * 0x8000 : value * 0x7fff), true);
  }
  return bytes;
}

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Base64 ohne `btoa` und ohne Buffer - so schreibt `expo-file-system` die Datei. */
export function toBase64(bytes: Uint8Array): string {
  let out = "";
  for (let n = 0; n < bytes.length; n += 3) {
    const a = bytes[n];
    const b = n + 1 < bytes.length ? bytes[n + 1] : 0;
    const c = n + 2 < bytes.length ? bytes[n + 2] : 0;
    const triple = (a << 16) | (b << 8) | c;
    out += ALPHABET[(triple >> 18) & 63] + ALPHABET[(triple >> 12) & 63];
    out += n + 1 < bytes.length ? ALPHABET[(triple >> 6) & 63] : "=";
    out += n + 2 < bytes.length ? ALPHABET[triple & 63] : "=";
  }
  return out;
}
