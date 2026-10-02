// Regen in der App (#771) - dieselbe Rechnung wie im Web (`frontend/src/seasons/weather/rain.js`): feine, schräge
// Striche in drei Tiefen, geneigt nach Wind und Böen, Menge nach `rain_mm`, nie deckender als 0,35, damit Schrift
// bleibt, wie sie ist. Die Funktionen, die je Bild laufen, sind Worklets (UI-Thread). Spritzer auf Kanten zeichnet
// die App nicht: dafür fehlen ihr die Kanten der Karten im Fenster.

import type { Size, WeatherLike, Wind } from "../snow/flakes";

export type RainDepthKey = "back" | "mid" | "front";
export type RainDepth = { share: number; length: [number, number]; speed: [number, number]; width: number; alpha: [number, number]; wind: number; scroll: number; splash: number };
export type Drop = { depth: RainDepthKey; x: number; y: number; length: number; speed: number; alpha: number; width: number; splashes: boolean; leaving?: boolean; done?: boolean };

/** Die drei Tiefen: Anteil, Länge des Strichs (px), Fallgeschwindigkeit (px/s), Breite, Deckkraft, Windanteil, Scrollanteil. */
export const RAIN_DEPTHS: Record<RainDepthKey, RainDepth> = {
  back: { share: 0.5, length: [7, 12], speed: [520, 680], width: 0.8, alpha: [0.08, 0.14], wind: 1.6, scroll: 0.55, splash: 0 },
  mid: { share: 0.32, length: [11, 18], speed: [720, 900], width: 1, alpha: [0.13, 0.2], wind: 2.4, scroll: 0.8, splash: 0.18 },
  front: { share: 0.18, length: [17, 27], speed: [950, 1250], width: 1.3, alpha: [0.2, 0.3], wind: 3.2, scroll: 1, splash: 0.35 },
};
export const RAIN_ORDER: RainDepthKey[] = ["back", "mid", "front"];
/** Nie deckender als das. */
export const MAX_ALPHA = 0.35;
/** Regen verträgt etwas mehr Teilchen als Schnee - ein Strich ist billig. */
export const RAIN_BUDGET = 1.2;
/** Wie weit seitlich über den Rand hinaus Tropfen entstehen, damit schräger Regen auch die Ränder trifft. */
export const SIDE_MARGIN = 160;

/** Wie stark es regnet: 0 (gar nicht) bis 1,2 (Starkregen) aus `rain_mm`. */
export function rainFactor(weather: WeatherLike): number {
  const rain = Math.max(0, Number(weather && weather.rain_mm) || 0);
  if (rain <= 0) return 0;
  if (rain < 0.3) return 0.35;
  if (rain < 1.5) return 0.65;
  if (rain < 4) return 1;
  return 1.2;
}

/** Wie viele Tropfen je Tiefe: Budget mal Screen mal Regenmenge; nachts etwas ruhiger. */
export function dropCounts(budget: number, { share = 1, factor = 0, night = false, area = 1 }: { share?: number; factor?: number; night?: boolean; area?: number } = {}) {
  const wide = Math.max(1, Number(area) || 1);
  const total = Math.round(Math.max(0, budget) * RAIN_BUDGET * Math.max(0, Math.min(1, share)) * Math.max(0, factor) * (night ? 0.8 : 1) * wide);
  const back = Math.round(total * RAIN_DEPTHS.back.share);
  const mid = Math.round(total * RAIN_DEPTHS.mid.share);
  return { back, mid, front: Math.max(0, total - back - mid), total };
}

function between(rng: () => number, [min, max]: [number, number]): number {
  "worklet";
  return min + rng() * (max - min);
}

/** Ein neuer Tropfen oben (oder, beim Start, irgendwo im Bild) - auch seitlich über den Rand hinaus. */
export function createDrop(depthKey: RainDepthKey, size: Size, rng: () => number, { anywhere = false }: { anywhere?: boolean } = {}): Drop {
  "worklet";
  const depth = RAIN_DEPTHS[depthKey] || RAIN_DEPTHS.mid;
  const length = between(rng, depth.length);
  return {
    depth: depthKey,
    x: -SIDE_MARGIN + rng() * (size.width + SIDE_MARGIN * 2),
    y: anywhere ? rng() * size.height : -length - rng() * 60,
    length,
    speed: between(rng, depth.speed),
    alpha: Math.min(MAX_ALPHA, between(rng, depth.alpha)),
    width: depth.width,
    splashes: rng() < depth.splash,
  };
}

/** Wie schnell der Tropfen seitlich treibt (px/s): der Wind mal der Anteil seiner Tiefe. */
export function driftOf(drop: Pick<Drop, "depth">, wind: Wind): number {
  "worklet";
  const depth = RAIN_DEPTHS[drop.depth] || RAIN_DEPTHS.mid;
  return wind.x * depth.wind;
}

/** Einen Schritt weiter. Unten hinaus: oben wieder herein, an neuer Stelle - außer `leaving`, dann ist er `done`. */
export function advanceDrop(drop: Drop, dt: number, wind: Wind, size: Size, rng: () => number = Math.random): number {
  "worklet";
  const previousY = drop.y;
  drop.x += driftOf(drop, wind) * dt;
  drop.y += drop.speed * dt;
  if (drop.y - drop.length > size.height) {
    if (drop.leaving) drop.done = true;
    else {
      drop.y = -drop.length - rng() * 40;
      drop.x = -SIDE_MARGIN + rng() * (size.width + SIDE_MARGIN * 2);
      drop.splashes = rng() < (RAIN_DEPTHS[drop.depth] || RAIN_DEPTHS.mid).splash;
    }
  }
  return previousY;
}

/** Scrollen: die Tropfen gehören zum Screen - vorne ganz, hinten weniger; hinausgeschoben kommen sie an neuer Stelle herein. */
export function scrollDrop(drop: Drop, deltaY: number, size: Size, rng: () => number = Math.random): Drop {
  "worklet";
  if (!deltaY) return drop;
  const depth = RAIN_DEPTHS[drop.depth] || RAIN_DEPTHS.mid;
  const margin = drop.length + 20;
  const span = size.height + margin * 2;
  const moved = drop.y - deltaY * depth.scroll;
  const wrapped = ((((moved + margin) % span) + span) % span) - margin;
  if (Math.abs(wrapped - moved) > 0.5) drop.x = -SIDE_MARGIN + rng() * (size.width + SIDE_MARGIN * 2);
  drop.y = wrapped;
  return drop;
}
