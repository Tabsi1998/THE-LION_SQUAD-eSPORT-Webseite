// Schneefall in der App (#642, #771) - dieselbe Rechnung wie im Web (`frontend/src/seasons/snow/flakes.js`): Flocken
// in drei Tiefen, hinten klein, weich und schnell, vorne groß, langsam und als Kristall; jede mit eigener Form, Größe,
// Fallgeschwindigkeit, Taumeln und Schwingen; Wind aus dem Wetter mit Böen alle 20–40 s. Die Funktionen, die je Bild
// laufen, sind Worklets: Reanimated rechnet sie auf dem UI-Thread, ohne JavaScript je Bild. Ein Paritätstest hält die
// Werte mit dem Web zusammen (`flakes.test.ts` und `frontend/src/seasons/snow/flakes.test.js`).

export type DepthKey = "back" | "mid" | "front";
export type FlakeShape = "dot" | "star" | "plate" | "needle" | "clump" | "dendrite";
export type Depth = { share: number; size: [number, number]; fall: [number, number]; wind: number; sway: [number, number]; spin: number; soft: boolean; scroll: number };
export type Gust = { at: number; length: number; strength: number };
export type Wind = { x: number; y: number; strength: number };
export type WindBase = { factor: number; sign: number };
export type Size = { width: number; height: number };
export type Flake = {
  depth: DepthKey;
  shape: FlakeShape;
  x: number;
  y: number;
  radius: number;
  fall: number;
  fast: boolean;
  swayAmp: number;
  swayFreq: number;
  phase: number;
  spiral: boolean;
  rotation: number;
  spin: number;
  opacity: number;
  age: number;
  leaving?: boolean;
  done?: boolean;
};
export type WeatherLike = { wind_factor?: number | null; wind_dir?: number | null; snow_cm?: number | null; rain_mm?: number | null } | null | undefined;

/** Die drei Tiefen: Anteil am Budget, Größe, Fallgeschwindigkeit (px/s), Anteil des Winds, Schwingweite. */
export const DEPTHS: Record<DepthKey, Depth> = {
  back: { share: 0.5, size: [1.2, 2.2], fall: [42, 70], wind: 0.45, sway: [4, 10], spin: 0, soft: true, scroll: 0.55 },
  mid: { share: 0.32, size: [2.2, 3.6], fall: [30, 52], wind: 0.75, sway: [8, 18], spin: 0.6, soft: false, scroll: 0.8 },
  front: { share: 0.18, size: [3.8, 6.5], fall: [18, 36], wind: 1.1, sway: [12, 26], spin: 1.2, soft: false, scroll: 1 },
};
export const DEPTH_ORDER: DepthKey[] = ["back", "mid", "front"];
/** Sechs Formen: weicher Punkt, Sternkristall, Plättchen, Nadelpaar, Klümpchen, Dendrit. */
export const SHAPES: FlakeShape[] = ["dot", "star", "plate", "needle", "clump", "dendrite"];
/** Böen: alle 20–40 s, 3–6 s lang, 1,6- bis 2,8-fach, mit weichem Anstieg und Abklingen. */
export const GUST = { every: [20, 40], length: [3, 6], strength: [1.6, 2.8], attack: 1, release: 2 };
/** Jede zwölfte Flocke ist ein schneller Ausreißer. */
export const FAST_EVERY = 12;

/** Der Wind aus dem Wetter: Stärke 0,3–1,6 (`wind_factor`), Richtung in Grad, aus der er kommt (270 = West → nach rechts). */
export function windFrom(weather: WeatherLike): WindBase {
  const factor = Math.max(0.3, Math.min(1.6, Number(weather && weather.wind_factor) || 0.6));
  const direction = Number(weather && weather.wind_dir);
  const sign = Number.isFinite(direction) ? (Math.sin((direction * Math.PI) / 180) <= 1e-9 ? 1 : -1) : 1;
  return { factor, sign };
}

/** Der Böenplan aus dem Zufallsstrom: wann die nächste kommt, wie lang, wie stark. */
export function nextGust(rng: () => number, now = 0): Gust {
  "worklet";
  const at = now + GUST.every[0] + rng() * (GUST.every[1] - GUST.every[0]);
  return { at, length: GUST.length[0] + rng() * (GUST.length[1] - GUST.length[0]), strength: GUST.strength[0] + rng() * (GUST.strength[1] - GUST.strength[0]) };
}

/** Wie stark die Böe gerade weht (1 = kein Zuschlag): weicher Anstieg, Plateau, Abklingen. */
export function gustAt(gust: Gust | null, t: number): number {
  "worklet";
  if (!gust || t < gust.at) return 1;
  const into = t - gust.at;
  if (into < GUST.attack) return 1 + (gust.strength - 1) * (into / GUST.attack);
  if (into < GUST.attack + gust.length) return gust.strength;
  const out = into - GUST.attack - gust.length;
  if (out < GUST.release) return 1 + (gust.strength - 1) * (1 - out / GUST.release);
  return 1;
}

/** Der Wind zum Zeitpunkt t (Sekunden): Grundwind mit langsamem Auf und Ab mal Böe; x in px/s (Vorzeichen = Richtung), y drückt etwas nach unten. */
export function windAt(t: number, base: WindBase = { factor: 0.6, sign: 1 }, gust: Gust | null = null): Wind {
  "worklet";
  const breath = 1 + 0.25 * Math.sin(t / 5.3) + 0.12 * Math.sin(t / 1.9 + 1);
  const strength = base.factor * breath * gustAt(gust, t);
  return { x: base.sign * (8 + 38 * strength), y: 6 * strength, strength };
}

function between(rng: () => number, [min, max]: [number, number]): number {
  "worklet";
  return min + rng() * (max - min);
}

/** Eine neue Flocke oben (oder, beim Start, irgendwo im Bild). */
export function createFlake(depthKey: DepthKey, size: Size, rng: () => number, { index = 0, anywhere = false }: { index?: number; anywhere?: boolean } = {}): Flake {
  "worklet";
  const depth = DEPTHS[depthKey] || DEPTHS.mid;
  const fast = !depth.soft && index % FAST_EVERY === FAST_EVERY - 1;
  const radius = between(rng, depth.size);
  const fall = between(rng, depth.fall) * (fast ? 2.2 : 1);
  const spiral = !depth.soft && rng() < 0.3;
  return {
    depth: depthKey,
    shape: depth.soft ? "dot" : SHAPES[Math.floor(rng() * SHAPES.length)],
    x: rng() * size.width,
    y: anywhere ? rng() * size.height : -radius * 2 - rng() * 40,
    radius,
    fall,
    fast,
    swayAmp: between(rng, depth.sway) * (spiral ? 0.6 : 1),
    swayFreq: 0.4 + rng() * 0.9,
    phase: rng() * Math.PI * 2,
    spiral,
    rotation: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 2 * depth.spin,
    opacity: depth.soft ? 0.35 + rng() * 0.3 : 0.6 + rng() * 0.35,
    age: rng() * 10,
  };
}

/**
 * Einen Schritt weiter: fallen, schwingen oder spiralen, driften mit dem Wind, taumeln; unten und seitlich wieder
 * hinein. `random` liefert die neue Stelle oben (im Web `Math.random`; in Tests fest).
 */
export function advanceFlake(flake: Flake, dt: number, wind: Wind, size: Size, random: () => number = Math.random): Flake {
  "worklet";
  const depth = DEPTHS[flake.depth] || DEPTHS.mid;
  flake.age += dt;
  const swing = Math.sin(flake.age * flake.swayFreq * Math.PI * 2 + flake.phase);
  const sway = flake.spiral ? Math.cos(flake.age * flake.swayFreq * Math.PI * 2 + flake.phase) * flake.swayAmp * 1.4 : swing * flake.swayAmp;
  flake.x += (sway + wind.x * depth.wind) * dt;
  flake.y += (flake.fall + wind.y * depth.wind + (flake.spiral ? Math.abs(swing) * 4 : 0)) * dt;
  flake.rotation += flake.spin * dt * (1 + wind.strength * 0.3);
  const margin = flake.radius * 3 + 10;
  if (flake.x < -margin) flake.x = size.width + margin;
  else if (flake.x > size.width + margin) flake.x = -margin;
  if (flake.y > size.height + margin) {
    // Lässt der Schneefall nach, fällt die Flocke zu Ende und kommt nicht wieder.
    if (flake.leaving) flake.done = true;
    else {
      flake.y = -margin;
      flake.x = random() * size.width;
    }
  }
  return flake;
}

/**
 * Scrollen: die Flocken gehören zum Screen, nicht zum Glas davor - wer scrollt, fährt an ihnen vorbei, vorne ganz,
 * hinten weniger (Ferne). Was oben oder unten hinausgeschoben wird, kommt auf der anderen Seite an neuer Stelle herein.
 */
export function scrollFlake(flake: Flake, deltaY: number, size: Size, random: () => number = Math.random): Flake {
  "worklet";
  if (!deltaY) return flake;
  const depth = DEPTHS[flake.depth] || DEPTHS.mid;
  const margin = flake.radius * 3 + 10;
  const span = size.height + margin * 2;
  const moved = flake.y - deltaY * depth.scroll;
  const wrapped = ((((moved + margin) % span) + span) % span) - margin;
  if (Math.abs(wrapped - moved) > 0.5) flake.x = random() * size.width;
  flake.y = wrapped;
  return flake;
}

/**
 * Wie viele Flocken je Tiefe: `budget` vom Gerät, `share` des Screens (Klasse), `factor` aus dem Wetter
 * (`snowfallFactor`; ohne Angabe `snowing` → volle Zahl, sonst 55 %), `fade` 0–1 gegen Ende der Saison.
 */
export function flakeCounts(budget: number, { share = 1, snowing = false, factor = null, fade = 1 }: { share?: number; snowing?: boolean; factor?: number | null; fade?: number } = {}) {
  const weight = factor === null || factor === undefined ? (snowing ? 1 : 0.55) : Math.max(0, Number(factor) || 0);
  const total = Math.round(Math.max(0, budget) * Math.max(0, Math.min(1, share)) * weight * Math.max(0, Math.min(1, fade)));
  const back = Math.round(total * DEPTHS.back.share);
  const mid = Math.round(total * DEPTHS.mid.share);
  return { back, mid, front: Math.max(0, total - back - mid), total };
}

/**
 * Wie dicht es schneit: ohne Niederschlag draußen `base` (in der Schnee-Saison 55 %), mit echtem Schnee mehr - und
 * weil es in der Schnee-Saison nie regnet, zählt Regen wie Schnee. Bei starkem Niederschlag bis 125 %.
 */
export function snowfallFactor(weather: WeatherLike, base = 0.55): number {
  const snow = Math.max(0, Number(weather && weather.snow_cm) || 0);
  const rain = Math.max(0, Number(weather && weather.rain_mm) || 0);
  const amount = snow + rain;
  if (amount <= 0) return base;
  if (amount < 0.3) return 0.8;
  if (amount < 1.5) return 1;
  return 1.25;
}

/** Der Ausklang: in den letzten zehn Minuten der Saison werden es weniger, kein hartes Abschalten. */
export function fadeAt(endsAt: string | null | undefined, now: number = Date.now()): number {
  const end = Date.parse(endsAt || "");
  if (!Number.isFinite(end)) return 1;
  const left = end - now;
  if (left <= 0) return 0;
  return Math.min(1, left / (10 * 60 * 1000));
}
