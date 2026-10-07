// Wimpelketten an Kanten (B2 #750, App S13 #644; Jahreszeiten IV #1094) - dieselbe Rechnung wie im Web
// (frontend/src/seasons/birthday/cardGarland.js, Paritätstest auf beiden Seiten): ein Faden in zwei flachen Bögen von
// Rand zu Rand im unteren Innenabstand einer Karte, daran Wimpel in Vereinsfarben - an der Begrüßungskarte und seit
// #1094 an einigen weiteren Karten. Wird die Karte angetippt, flattert die Kette einmal durch: eine Welle läuft in einer
// Sekunde von links nach rechts, jeder Wimpel schwingt um seine Aufhängung und kommt zur Ruhe. Reine Rechnung.

import { seasonRng } from "../rng";
import { CLUB } from "./cake";

/** Die Kette an einer Kante: das Band beginnt `band` Punkte über der Unterkante, Einzug, ein Wimpel je `step` Punkte. */
export const EDGE_GARLAND = { band: 16, inset: 14, step: 18, minSpan: 80 };
export const PENNANT_COLORS = [CLUB.cyan, CLUB.gold, CLUB.white];

export const PENNANT_FLUTTER = {
  /** So lange flattert die ganze Kette (ms), so lange ein Wimpel. */
  ms: 1000,
  each: 680,
  /** So weit schwingt ein Wimpel beim ersten Ausschlag (Grad). */
  swing: 16,
  /** [Bruchteil der Zeit eines Wimpels, Ausschlag als Bruchteil von `swing`] - hin, her, kleiner, Ruhe. */
  keys: [[0, 0], [0.2, 1], [0.45, -0.65], [0.7, 0.32], [0.88, -0.1], [1, 0]] as Array<[number, number]>,
};

export type Pennant = { x: number; y: number; color: string; size: number };

const round = (value: number) => Math.round(value * 10) / 10;

/**
 * Die Wimpel an einer Kante der Breite `width`: Lage (x, Aufhängung y), Farbe und Größe. `place` trennt die Ketten
 * („edge“ ist die Begrüßungskarte, „card:<Platz>“ eine weitere Karte) - je Jahr und Stelle fest.
 */
export function edgePennants(width: number, year: number, place = "edge"): Pennant[] {
  const rng = seasonRng({ season: "club_birthday", year, screen: place }, "garland");
  const span = width - EDGE_GARLAND.inset * 2;
  if (span < EDGE_GARLAND.minSpan) return [];
  const count = Math.max(3, Math.round(span / EDGE_GARLAND.step));
  const first = Math.floor(rng() * PENNANT_COLORS.length);
  const sag = 2.5 + rng() * 1.5;
  return Array.from({ length: count }, (_, index) => {
    const t = (index + 0.5) / count;
    const x = EDGE_GARLAND.inset + span * t;
    // Zwei flache Bögen über die Breite - wie an zwei Nägeln aufgehängt.
    const local = (t * 2) % 1;
    return { x: round(x), y: round(2 + 4 * sag * local * (1 - local)), color: PENNANT_COLORS[(first + index) % PENNANT_COLORS.length], size: round(8 + rng() * 2) };
  });
}

/** Der Faden durch die Aufhängungen, von Rand zu Rand. */
export function edgeString(pennants: Pennant[], width: number): string {
  return pennants.length ? `M 0 1 ${pennants.map((pennant) => `L ${pennant.x} ${pennant.y}`).join(" ")} L ${width} 1` : "";
}

/** Wann ein Wimpel zu flattern beginnt (ms): die Welle läuft in `ms - each` von links nach rechts. */
export function pennantDelay(index: number, count: number): number {
  return count > 1 ? Math.round(((PENNANT_FLUTTER.ms - PENNANT_FLUTTER.each) * index) / (count - 1)) : 0;
}

/** Der Ausschlag eines Wimpels zur Zeit `ms` (Grad). */
export function pennantAngle(ms: number, index: number, count: number): number {
  const t = Math.max(0, Math.min(1, ((Number(ms) || 0) - pennantDelay(index, count)) / PENNANT_FLUTTER.each));
  const keys = PENNANT_FLUTTER.keys;
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    if (t <= t1) return Math.round((v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)) * PENNANT_FLUTTER.swing * 100) / 100;
  }
  return 0;
}

/** Ein Wimpel als Animation über die ganze Dauer (0 bis 1): warten, bis die Welle da ist, schwingen, ruhen. */
export function pennantFrames(index: number, count: number): { inputRange: number[]; outputRange: string[] } {
  const start = pennantDelay(index, count) / PENNANT_FLUTTER.ms;
  const span = PENNANT_FLUTTER.each / PENNANT_FLUTTER.ms;
  const keys = PENNANT_FLUTTER.keys.map(([t, v]) => [Math.round((start + t * span) * 10000) / 10000, v * PENNANT_FLUTTER.swing]);
  const head = keys[0][0] > 0 ? [[0, 0]] : [];
  const tail = keys[keys.length - 1][0] < 1 ? [[1, 0]] : [];
  const all = [...head, ...keys, ...tail];
  return { inputRange: all.map(([t]) => t), outputRange: all.map(([, v]) => `${Math.round(v * 100) / 100 || 0}deg`) };
}
