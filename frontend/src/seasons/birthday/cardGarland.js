// Wimpelketten an Karten (Jahreszeiten IV, Variante B, #1094): Neben den Ketten unter der Kopfzeile hängt im unteren
// Innenabstand einiger Karten eine kleine Wimpelkette - dieselbe wie an der Begrüßungskarte der App: ein Faden in zwei
// flachen Bögen von Rand zu Rand, daran Wimpel in Vereinsfarben. Hebt sich die Karte, flattert die Kette einmal durch:
// eine Welle läuft von links nach rechts, jeder Wimpel schwingt um seine Aufhängung und kommt zur Ruhe - alles in einer
// Sekunde. Reine Rechnung; die Anzeige liegt in CardGarlands.jsx (die Keyframes in birthday.css folgen PENNANT_FLUTTER),
// die App rechnet dasselbe (mobile/src/seasons/birthday/garland.ts, Paritätstest auf beiden Seiten).

import { seasonRng } from "../rng";
import { PENNANT_COLORS } from "./garland";

/** Die Kette an einer Kante: das Band beginnt `band` px über der Unterkante, Einzug, ein Wimpel je `step` px. */
export const EDGE_GARLAND = { band: 16, inset: 14, step: 18, minSpan: 80 };

export const PENNANT_FLUTTER = {
  /** So lange flattert die ganze Kette (ms), so lange ein Wimpel. */
  ms: 1000,
  each: 680,
  /** So weit schwingt ein Wimpel beim ersten Ausschlag (Grad). */
  swing: 16,
  /** [Bruchteil der Zeit eines Wimpels, Ausschlag als Bruchteil von `swing`] - hin, her, kleiner, Ruhe. */
  keys: [[0, 0], [0.2, 1], [0.45, -0.65], [0.7, 0.32], [0.88, -0.1], [1, 0]],
};

const round = (value) => Math.round(value * 10) / 10;

/**
 * Die Wimpel an einer Kante der Breite `width`: Lage (x, Aufhängung y), Farbe und Größe. `place` trennt die Ketten
 * („edge“ ist die Begrüßungskarte der App, „card:3“ eine Karte) - je Jahr und Stelle fest.
 */
export function edgePennants(width, year, place = "edge") {
  const rng = seasonRng({ season: "club_birthday", year, route: place }, "garland");
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
export function edgeString(pennants, width) {
  return pennants.length ? `M 0 1 ${pennants.map((pennant) => `L ${pennant.x} ${pennant.y}`).join(" ")} L ${width} 1` : "";
}

/** Wann ein Wimpel zu flattern beginnt (ms): die Welle läuft in `ms - each` von links nach rechts. */
export function pennantDelay(index, count) {
  return count > 1 ? Math.round(((PENNANT_FLUTTER.ms - PENNANT_FLUTTER.each) * index) / (count - 1)) : 0;
}

/** Der Ausschlag eines Wimpels zur Zeit `ms` (Grad) - für Tests und die App; im Web machen es die Keyframes. */
export function pennantAngle(ms, index, count) {
  const t = Math.max(0, Math.min(1, ((Number(ms) || 0) - pennantDelay(index, count)) / PENNANT_FLUTTER.each));
  const keys = PENNANT_FLUTTER.keys;
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    if (t <= t1) return Math.round((v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)) * PENNANT_FLUTTER.swing * 100) / 100;
  }
  return 0;
}
