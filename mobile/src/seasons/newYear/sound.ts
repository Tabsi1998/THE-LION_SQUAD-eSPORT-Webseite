import * as SecureStore from "expo-secure-store";
import { useEffect, useState } from "react";
import { SAMPLE_RATE, encodeWav, toBase64 } from "../sound/synth";
import type { ShellType } from "./fireworks";

// Silvester-Klang in der App (N4 #742, wie newYear/sound.js im Web): Zischen beim Aufstieg, Knall je Art, Knistern -
// einmal als Zahlenreihe gerechnet, als WAV in den Cache gelegt und von dort gespielt. Nur nach ausdrücklichem
// Einschalten (eigener Schalter, Vorgabe aus, je Gerät), nie bei Lautlos oder Vibration, ohne andere Apps zu
// unterbrechen; ferne Raketen leiser, höchstens drei Klänge zugleich.

export const NEW_YEAR_SOUND_KEY = "newyear_sounds";
export const MAX_VOICES = 3;
export const MIN_GAP_MS = 120;
export const SOUND_VERSION = 1;

export type FireSound = "whistle" | `boom-${ShellType}`;

/** Wie ein Knall je Art klingt - wie BURST_VOICES im Web: Länge, Tiefe, Knistern danach. */
export const BURST_VOICES: Record<ShellType, { seconds: number; cutoff: number; crackle: number }> = {
  peony: { seconds: 0.9, cutoff: 900, crackle: 0 },
  chrysanthemum: { seconds: 1.1, cutoff: 1100, crackle: 0.25 },
  willow: { seconds: 1.6, cutoff: 600, crackle: 0.15 },
  crackle: { seconds: 0.7, cutoff: 1400, crackle: 1 },
  ring: { seconds: 0.8, cutoff: 1000, crackle: 0 },
  heart: { seconds: 0.9, cutoff: 950, crackle: 0.2 },
};

export function volumeFor(distance: number): number {
  return Math.round((1 - 0.65 * Math.max(0, Math.min(1, Number(distance) || 0))) * 100) / 100;
}

/** Fester Zufall für das Rauschen - derselbe Laut bei jedem Rechnen. */
function noiseSource(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296) * 2 - 1;
  };
}

/** Das Zischen: Rauschen durch einen Bandpass, dessen Mitte von 1,8 auf 4,2 kHz steigt; leise an, langsam aus. */
export function renderWhistle(seconds = 1.3, sampleRate = SAMPLE_RATE): Float32Array {
  const total = Math.floor(seconds * sampleRate);
  const out = new Float32Array(total);
  const noise = noiseSource(1);
  let low = 0;
  let band = 0;
  for (let n = 0; n < total; n += 1) {
    const t = n / sampleRate;
    // Höchstens ein Viertel der Abtastrate: darüber wird dieser Filter instabil.
    const centre = Math.min(1800 * Math.pow(4200 / 1800, t / seconds), sampleRate / 4);
    const f = 2 * Math.sin((Math.PI * centre) / sampleRate);
    // State-variable-Filter: Bandpass mit fester Güte.
    const input = noise();
    const high = input - low - 0.33 * band;
    band += f * high;
    low += f * band;
    const env = t < 0.15 ? t / 0.15 : Math.exp(-2.4 * (t - 0.15));
    out[n] = band * env;
  }
  // Leiser als der Knall und nie übersteuert - gleich laut, egal wie das Rauschen ausfällt.
  let peak = 0;
  for (let n = 0; n < total; n += 1) peak = Math.max(peak, Math.abs(out[n]));
  const scale = peak > 0 ? 0.45 / peak : 1;
  for (let n = 0; n < total; n += 1) out[n] *= scale;
  return out;
}

/** Der Knall: ein tiefer Schlag und gefiltertes Rauschen mit schnellem Abklingen; je Art anders lang und dumpf. */
export function renderBoom(type: ShellType, sampleRate = SAMPLE_RATE): Float32Array {
  const voice = BURST_VOICES[type] || BURST_VOICES.peony;
  const total = Math.floor((voice.seconds + (voice.crackle > 0 ? 0.9 : 0)) * sampleRate);
  const out = new Float32Array(total);
  const noise = noiseSource(7 + type.length);
  const a = Math.exp((-2 * Math.PI * voice.cutoff) / sampleRate);
  let low = 0;
  for (let n = 0; n < total; n += 1) {
    const t = n / sampleRate;
    low = (1 - a) * noise() + a * low;
    const body = t < voice.seconds ? Math.exp((-5 * t) / voice.seconds) : 0;
    const thump = t < 0.25 ? Math.sin(2 * Math.PI * 58 * t) * Math.exp(-14 * t) : 0;
    out[n] = low * body * 2.4 + thump * 0.55;
  }
  if (voice.crackle > 0) {
    // Knistern: kurze, helle Klicks nach dem Knall.
    const clicks = Math.round(8 * voice.crackle) + 2;
    const pick = noiseSource(31 + clicks);
    for (let c = 0; c < clicks; c += 1) {
      const start = Math.floor((0.25 + ((pick() + 1) / 2) * 0.6) * sampleRate);
      const length = Math.floor(0.02 * sampleRate);
      let prev = 0;
      for (let n = 0; n < length && start + n < total; n += 1) {
        const sample = pick();
        const high = sample - prev;
        prev = sample;
        out[start + n] += high * 0.3 * Math.exp((-5 * n) / length);
      }
    }
  }
  let peak = 0;
  for (let n = 0; n < total; n += 1) peak = Math.max(peak, Math.abs(out[n]));
  const scale = peak > 0 ? 0.7 / peak : 1;
  for (let n = 0; n < total; n += 1) out[n] *= scale;
  return out;
}

let soundOn: boolean | null = null;
const listeners = new Set<(on: boolean) => void>();
const files = new Map<string, Promise<string | null>>();
let voices = 0;
let lastPlayed = -Infinity;
let audioReady: Promise<void> | null = null;

/** Ist der Silvester-Ton an? Vorgabe aus (#640: Ton nur auf Wunsch). */
export async function readNewYearSound(): Promise<boolean> {
  if (soundOn === null) {
    try {
      soundOn = (await SecureStore.getItemAsync(NEW_YEAR_SOUND_KEY)) === "on";
    } catch {
      soundOn = false;
    }
  }
  return soundOn;
}

export async function setNewYearSound(on: boolean): Promise<void> {
  soundOn = Boolean(on);
  listeners.forEach((listener) => listener(Boolean(on)));
  try {
    await SecureStore.setItemAsync(NEW_YEAR_SOUND_KEY, on ? "on" : "off");
  } catch {
    // dann eben nur für diese Sitzung
  }
}

export function useNewYearSound(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(Boolean(soundOn));
  useEffect(() => {
    let alive = true;
    void readNewYearSound().then((value) => {
      if (alive) setOn(value);
    });
    listeners.add(setOn);
    return () => {
      alive = false;
      listeners.delete(setOn);
    };
  }, []);
  return [on, (next: boolean) => void setNewYearSound(next)];
}

/** Nur für Tests. */
export function resetNewYearSound(): void {
  soundOn = null;
  files.clear();
  voices = 0;
  lastPlayed = -Infinity;
  audioReady = null;
}

type FileSystemLike = typeof import("expo-file-system/legacy");
type AudioLike = Pick<typeof import("expo-audio"), "createAudioPlayer" | "setAudioModeAsync">;

function loadModules(): { fs: FileSystemLike; audio: AudioLike } | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require("expo-file-system/legacy") as FileSystemLike;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const audio = require("expo-audio") as AudioLike;
    return fs && audio && typeof audio.createAudioPlayer === "function" ? { fs, audio } : null;
  } catch {
    return null;
  }
}

function soundFile(fs: FileSystemLike, name: FireSound): Promise<string | null> {
  let pending = files.get(name);
  if (!pending) {
    pending = (async () => {
      const dir = `${fs.cacheDirectory || ""}newyear-sounds/`;
      const uri = `${dir}${name}-v${SOUND_VERSION}.wav`;
      const info = await fs.getInfoAsync(uri);
      if (!info.exists) {
        await fs.makeDirectoryAsync(dir, { intermediates: true }).catch(() => undefined);
        const samples = name === "whistle" ? renderWhistle() : renderBoom(name.slice(5) as ShellType);
        await fs.writeAsStringAsync(uri, toBase64(encodeWav(samples, SAMPLE_RATE)), { encoding: fs.EncodingType.Base64 });
      }
      return uri;
    })().catch(() => {
      files.delete(name);
      return null;
    });
    files.set(name, pending);
  }
  return pending;
}

/** Einen Klang spielen - nur eingeschaltet, mit Abstand und höchstens drei zugleich. `true`, wenn gespielt wurde. */
export async function playFireSound(name: FireSound, distance = 0.5, now = Date.now()): Promise<boolean> {
  if (!(await readNewYearSound())) return false;
  if (voices >= MAX_VOICES || now - lastPlayed < MIN_GAP_MS) return false;
  lastPlayed = now;
  const modules = loadModules();
  if (!modules) return false;
  const { fs, audio } = modules;
  voices += 1;
  try {
    const uri = await soundFile(fs, name);
    if (!uri) {
      voices = Math.max(0, voices - 1);
      return false;
    }
    audioReady = audioReady || audio.setAudioModeAsync({ playsInSilentMode: false, interruptionMode: "mixWithOthers" }).catch(() => undefined);
    await audioReady;
    const player = audio.createAudioPlayer({ uri });
    player.volume = volumeFor(distance);
    player.play();
    const seconds = name === "whistle" ? 1.3 : (BURST_VOICES[name.slice(5) as ShellType]?.seconds || 1) + 0.9;
    setTimeout(() => {
      voices = Math.max(0, voices - 1);
      try {
        player.remove();
        player.release();
      } catch {
        // schon weg
      }
    }, seconds * 1000 + 300);
    return true;
  } catch {
    voices = Math.max(0, voices - 1);
    return false;
  }
}
