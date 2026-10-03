// Silvester in der App (S11 #642; N1 #739): dieselbe Rechnung wie im Web (frontend/src/seasons/newYear/fireworks.js) -
// Aufstieg, Explosion je Art, Nachglühen, Rauch, Wind, Entfernung. Was je Bild läuft, trägt "worklet": es läuft auf
// dem UI-Thread (Reanimated), gezeichnet wird mit Skia. Ein Fingerabdruck in beiden Tests hält die Rechnungen gleich.

import { glyphSpot, isGlyph, yearDuration } from "./yearDigits";

export const GRAVITY = 46;

export type ShellType = "peony" | "chrysanthemum" | "willow" | "crackle" | "ring" | "heart";
export type Shell = { stars: [number, number]; speed: [number, number]; drag: number; gravity: number; life: [number, number]; trail: number; glitter: number; rise: [number, number]; size: number };

export const SHELLS: Record<ShellType, Shell> = {
  peony: { stars: [56, 80], speed: [190, 260], drag: 1.55, gravity: 1, life: [1.3, 1.8], trail: 0, glitter: 0, rise: [1.2, 1.5], size: 2.2 },
  chrysanthemum: { stars: [48, 68], speed: [195, 265], drag: 1.4, gravity: 1, life: [1.7, 2.3], trail: 0.2, glitter: 0.4, rise: [1.3, 1.6], size: 1.9 },
  willow: { stars: [40, 58], speed: [130, 175], drag: 1.45, gravity: 0.55, life: [3.2, 4.2], trail: 0.6, glitter: 0.2, rise: [1.55, 1.9], size: 1.7 },
  crackle: { stars: [36, 50], speed: [165, 225], drag: 1.6, gravity: 0.9, life: [1.0, 1.35], trail: 0.08, glitter: 0, rise: [1.05, 1.3], size: 1.7 },
  ring: { stars: [36, 48], speed: [200, 230], drag: 1.5, gravity: 0.8, life: [1.4, 1.8], trail: 0.1, glitter: 0, rise: [1.3, 1.6], size: 2.0 },
  heart: { stars: [42, 54], speed: [160, 185], drag: 1.35, gravity: 0.65, life: [1.6, 2.0], trail: 0.1, glitter: 0, rise: [1.4, 1.7], size: 2.1 },
};
export const SHELL_TYPES = Object.keys(SHELLS) as ShellType[];

/** Kaliber (#853) wie im Web: klein, groß (bisher), sehr groß - Sterne, Tempo, Sterngröße, Leben, tiefer zerplatzen. */
export type Caliber = "small" | "large" | "giant";
export type CaliberShape = { stars: number; speed: number; size: number; life: number; lower: number };
export const CALIBERS: Record<Caliber, CaliberShape> = {
  small: { stars: 0.62, speed: 0.7, size: 0.85, life: 0.85, lower: 0 },
  large: { stars: 1, speed: 1, size: 1, life: 1, lower: 0 },
  giant: { stars: 1.4, speed: 1.3, size: 1.15, life: 1.2, lower: 0.07 },
};
export const CALIBER_TYPES = Object.keys(CALIBERS) as Caliber[];

export const COLORS = { blue: "#29B6E8", gold: "#ffc857", silver: "#dfe7ee", white: "#ffffff", red: "#e8453c", green: "#4fd18b", violet: "#a678f0" } as const;
export type ColorName = keyof typeof COLORS;
export const EMBER = "#ff8a3c";

export type Launch = {
  id: string;
  at: number;
  type: ShellType;
  /** Kaliber (#853) - ohne Angabe „groß“. */
  caliber?: Caliber;
  /** Ziffer der Jahreszahl (#853, yearDigits.ts) mit der ganzen Zahl und ihrem Platz darin. */
  glyph?: string;
  text?: string;
  slot?: number;
  slots?: number;
  x: number;
  distance: number;
  colors: [ColorName, ColorName];
  burstY: number;
  rise: number;
  drift: number;
  pattern?: string;
};
export type Star = { vx: number; vy: number; life: number; size: number; color: ColorName; glitter: number | null; crackleAt: number | null };
export type Point = { x: number; y: number };
export type Size = { width: number; height: number };

/** Das Kaliber einer Rakete - ohne Angabe „groß“ (so sah jede Rakete bis #853 aus). */
export function caliberOf(launch: Pick<Launch, "caliber"> | null | undefined): CaliberShape {
  "worklet";
  return (launch?.caliber && CALIBERS[launch.caliber]) || CALIBERS.large;
}

/** Höchstens so viele Sterne hat eine Rakete ihrer Art und ihres Kalibers - danach richtet sich das Budget. */
export function maxStars(launch: Pick<Launch, "type" | "caliber">): number {
  "worklet";
  const shell = SHELLS[launch.type] || SHELLS.peony;
  return Math.round(shell.stars[1] * caliberOf(launch).stars);
}

function clamp01(value: number): number {
  "worklet";
  return Math.max(0, Math.min(1, Number(value) || 0));
}

/** Zufall wie `between` im Web - aus einem Strom 0..1. */
export function between(rng: () => number, min: number, max: number): number {
  "worklet";
  return min + rng() * (max - min);
}

/** FNV-1a wie `hashString` (rng.ts), aber auf dem UI-Thread lauffähig. */
export function hashText(value: string): number {
  "worklet";
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32 wie in rng.ts, auf dem UI-Thread lauffähig: derselbe Strom aus derselben Saat. */
export function seededRandom(seed: number): () => number {
  "worklet";
  let state = seed >>> 0;
  return () => {
    "worklet";
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function spreadFor(size: Size): number {
  "worklet";
  return Math.round(Math.max(0.5, Math.min(1.3, (Number(size?.height) || 900) / 900)) * 100) / 100;
}

export function distanceScale(distance: number): number {
  "worklet";
  return 1 - 0.45 * clamp01(distance);
}

export function distanceLight(distance: number): number {
  "worklet";
  return 1 - 0.4 * clamp01(distance);
}

export function soundDelay(distance: number): number {
  "worklet";
  return Math.round((0.05 + 0.85 * clamp01(distance)) * 100) / 100;
}

export function windDrift(weather: { wind_factor?: number | null; wind_dir?: number | null } | null | undefined): number {
  const factor = Math.max(0, Math.min(2, Number(weather?.wind_factor ?? 0.6)));
  const dir = Number(weather?.wind_dir);
  const sign = Number.isFinite(dir) ? (Math.sin(((dir + 180) * Math.PI) / 180) >= 0 ? 1 : -1) : 1;
  return Math.round(sign * factor * 14 * 100) / 100;
}

function easeOutQuad(t: number): number {
  "worklet";
  return 1 - (1 - t) * (1 - t);
}

export function burstPoint(launch: Launch, size: Size, wind = 0): Point {
  "worklet";
  if (isGlyph(launch)) {
    const spot = glyphSpot(launch.slot ?? 0, launch.slots ?? 1, size);
    return { x: Math.round((spot.x + wind * launch.rise * 0.5) * 10) / 10, y: spot.y };
  }
  return {
    x: Math.round((launch.x * size.width + launch.drift * distanceScale(launch.distance) + wind * launch.rise * 0.5) * 10) / 10,
    y: Math.round(launch.burstY * size.height * 10) / 10,
  };
}

export function rocketAt(launch: Launch, t: number, size: Size, wind = 0): { x: number; y: number; speed: number } | null {
  "worklet";
  if (t < 0 || t > launch.rise) return null;
  const p = easeOutQuad(t / launch.rise);
  const startY = size.height + 12;
  const burst = burstPoint(launch, size, wind);
  const x0 = isGlyph(launch) ? glyphSpot(launch.slot ?? 0, launch.slots ?? 1, size).x : launch.x * size.width;
  return {
    x: Math.round((x0 + (burst.x - x0) * p) * 10) / 10,
    y: Math.round((startY + (burst.y - startY) * p) * 10) / 10,
    speed: Math.round((1 - t / launch.rise) * 100) / 100,
  };
}

function heartPoint(t: number): Point {
  "worklet";
  const x = 16 * Math.sin(t) ** 3;
  const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
  return { x: x / 17, y: y / 17 };
}

/** Die Sterne einer Explosion - wie `burstStars` im Web; `scale` ist der Anteil am Budget, `spread` die Größe, das Kaliber macht die Kugel kleiner oder größer. */
export function burstStars(launch: Launch, rng: () => number, scale = 1, spread = 1): Star[] {
  "worklet";
  const shell = SHELLS[launch.type] || SHELLS.peony;
  const caliber = caliberOf(launch);
  const near = distanceScale(launch.distance);
  const wanted = Math.round(between(rng, shell.stars[0], shell.stars[1]) * caliber.stars);
  const count = Math.max(12, Math.round(wanted * Math.max(0, Math.min(1, scale))));
  const speed = between(rng, shell.speed[0], shell.speed[1]) * near * spread * caliber.speed;
  const tilt = launch.type === "ring" ? between(rng, 0.3, 0.75) : 1;
  const spin = between(rng, 0, Math.PI * 2);
  const stars: Star[] = [];
  for (let i = 0; i < count; i += 1) {
    let dx: number;
    let dy: number;
    let v = speed;
    if (launch.type === "ring") {
      const a = spin + (i / count) * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a) * tilt;
    } else if (launch.type === "heart") {
      const point = heartPoint((i / count) * Math.PI * 2);
      dx = point.x;
      dy = point.y;
    } else {
      const a = between(rng, 0, Math.PI * 2);
      const z = between(rng, -1, 1);
      const r = Math.sqrt(1 - z * z);
      dx = Math.cos(a) * r;
      dy = Math.sin(a) * r;
      v = speed * between(rng, 0.92, 1.04);
    }
    const second = rng() < 0.28;
    stars.push({
      vx: Math.round(dx * v * 100) / 100,
      vy: Math.round(dy * v * 100) / 100,
      life: Math.round(between(rng, shell.life[0], shell.life[1]) * caliber.life * 100) / 100,
      size: Math.round(shell.size * near * between(rng, 0.8, 1.2) * caliber.size * 100) / 100,
      color: second ? launch.colors[1] : launch.colors[0],
      glitter: rng() < shell.glitter ? Math.round(between(rng, 0, Math.PI * 2) * 100) / 100 : null,
      crackleAt: launch.type === "crackle" ? Math.round(between(rng, 0.55, 0.78) * 100) / 100 : null,
    });
  }
  return stars;
}

export function starAt(star: Pick<Star, "vx" | "vy">, age: number, shell: Shell, origin: Point, wind = 0, distance = 0): Point {
  "worklet";
  const k = shell.drag;
  const g = GRAVITY * shell.gravity * distanceScale(distance);
  const decay = (1 - Math.exp(-k * age)) / k;
  const terminal = g / k;
  return {
    x: Math.round((origin.x + star.vx * decay + wind * age * 0.6) * 10) / 10,
    y: Math.round((origin.y + terminal * age + (star.vy - terminal) * decay) * 10) / 10,
  };
}

export function starLight(star: Pick<Star, "life" | "glitter" | "crackleAt">, age: number): { alpha: number; ember: number } {
  "worklet";
  const p = age / star.life;
  if (p >= 1 || p < 0) return { alpha: 0, ember: 0 };
  if (star.crackleAt !== null && star.crackleAt !== undefined && p >= star.crackleAt) return { alpha: 0, ember: 0 };
  let alpha = p < 0.06 ? 1 : p < 0.6 ? 0.95 : 0.95 * (1 - (p - 0.6) / 0.4) ** 1.4;
  if (star.glitter !== null && star.glitter !== undefined && p > 0.25) alpha *= 0.55 + 0.45 * Math.abs(Math.sin(age * 38 + star.glitter));
  const ember = p < 0.6 ? 0 : Math.min(1, (p - 0.6) / 0.35);
  return { alpha: Math.round(alpha * 1000) / 1000, ember: Math.round(ember * 1000) / 1000 };
}

export const CRACKLE_SECONDS = 0.14;

export function crackleFlashes(rng: () => number): Array<{ dx: number; dy: number; size: number }> {
  "worklet";
  const n = 3 + Math.floor(rng() * 3);
  const out: Array<{ dx: number; dy: number; size: number }> = [];
  for (let i = 0; i < n; i += 1) out.push({ dx: Math.round(between(rng, -5, 5) * 10) / 10, dy: Math.round(between(rng, -5, 5) * 10) / 10, size: Math.round(between(rng, 0.6, 1.3) * 100) / 100 });
  return out;
}

export const SMOKE_SECONDS = 9;

export function smokeAt(origin: Point, age: number, wind = 0, distance = 0): { x: number; y: number; r: number; alpha: number } | null {
  "worklet";
  if (age < 0 || age > SMOKE_SECONDS) return null;
  const scale = distanceScale(distance);
  const p = age / SMOKE_SECONDS;
  return {
    x: Math.round((origin.x + wind * age * 0.9) * 10) / 10,
    y: Math.round((origin.y - 5 * age) * 10) / 10,
    r: Math.round((24 + 70 * Math.sqrt(p)) * scale * 10) / 10,
    alpha: Math.round(0.11 * (1 - p) ** 1.3 * distanceLight(distance) * 1000) / 1000,
  };
}

export function trailRate(launch: Pick<Launch, "distance">): number {
  "worklet";
  return Math.round(60 * distanceScale(launch.distance));
}

export const SPARK_SECONDS = 0.45;

export function launchDuration(launch: Pick<Launch, "type" | "rise" | "caliber" | "glyph">): number {
  "worklet";
  if (isGlyph(launch)) return yearDuration(launch);
  const shell = SHELLS[launch.type] || SHELLS.peony;
  return Math.round((launch.rise + shell.life[1] * caliberOf(launch).life + 0.2) * 100) / 100;
}
