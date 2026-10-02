// Der Adventkranz in der App (S6, #637; W1, #727; S11, #642): vier Kerzen auf einem Ring aus Tannenzweigen, jede
// anders - eigene Höhe, leichte Neigung, eigene Flammenfrequenz und -stärke, eigenes Glimmen des Dochts, eigene
// Wachsspur. Alles kommt aus dem Jahres-Seed (C4): dieses Jahr immer derselbe Kranz, nächstes Jahr ein anderer -
// und derselbe wie auf der Website (frontend/src/seasons/advent/wreath.js; ein Paritätstest hält beide zusammen).
// Reine Rechnung ohne React; die Anzeige liegt in WreathSvg.tsx.

import { between, pick, seasonRng } from "../rng";
import { daysSince } from "./calendar";

/** Zeichenfläche des Kranzes (SVG-Einheiten). */
export const VIEW = { width: 76, height: 44 };
/** Der Ring, leicht von oben gesehen. */
export const RING = { cx: 38, cy: 31, rx: 31, ry: 8.5 };
/** Wo die vier Kerzen stehen (auf der vorderen Hälfte des Rings, damit man sie ganz sieht). */
export const CANDLE_X = [15, 30.5, 45.5, 61];
export const CANDLE_WIDTH = 4.6;
/** Flammen-Dauern: keine zwei Kerzen gleich (0,9/1,3/1,7 s aus #637 plus eine vierte). */
const FLAME_DURATIONS = [0.9, 1.3, 1.7, 1.1];
const NEEDLE_SHADES = ["#2f6b3a", "#3f8a4a", "#245a30", "#356f3f", "#1f4f29"];
const NEEDLE_LIGHT = "#5aa35f";
const WAX_TINTS = ["#f6ead2", "#f3e4c8", "#f8eedb", "#f1e0c4"];
/** Wie weit eine Kerze in vier Wochen herunterbrennt und wie lang die Wachsspur wird (SVG-Einheiten). */
export const BURN_DOWN = 2.6;
export const DRIP_LENGTH = 7;
/** Beeren wachsen zu dritt: die Versätze um den Mittelpunkt (mal Radius). */
export const BERRY_TRIAD: Array<[number, number]> = [[0, -0.9], [-0.95, 0.6], [0.95, 0.6]];

export type Ring = { cx: number; cy: number; rx: number; ry: number };
export type Candle = {
  index: number; x: number; y: number; height: number; lean: number; flameDuration: number; flameDelay: number; flameAmp: number;
  glowDuration: number; wickGlow: number; dripSide: -1 | 1; dripLength: number; tint: string;
};
export type Needle = { length: number; spread: number; tilt: number };
export type Cluster = { angle: number; front: boolean; shade: string; swayDelay: number; needles: Needle[] };
export type Berry = { angle: number; inset: number; radius: number; turn: number };
export type Bow = { angle: number; size: number; tilt: number };
export type WreathLayout = { year: number; candles: Candle[]; clusters: Cluster[]; berries: Berry[]; bows: Bow[] };

/** Ein Punkt auf dem Ring: Winkel 0 = rechts, 90 = vorne (unten im Bild). */
export function ringPoint(angleDeg: number, ring: Ring = RING): { x: number; y: number } {
  const a = (angleDeg * Math.PI) / 180;
  return { x: ring.cx + ring.rx * Math.cos(a), y: ring.cy + ring.ry * Math.sin(a) };
}

/** Die Höhe des vorderen Ringrands an einer Stelle x - dort steht die Kerze. */
export function ringFrontY(x: number, ring: Ring = RING): number {
  const t = Math.max(-1, Math.min(1, (x - ring.cx) / ring.rx));
  return ring.cy + ring.ry * Math.sqrt(1 - t * t);
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Der Kranz eines Jahres: Kerzen, Zweigbüschel (hinten und vorne), Beeren und Schleifen. `salt` ist frei
 * (Gerät, Tests); ohne Salz sehen alle denselben Kranz. Die Saat heißt wie im Web `advent:<jahr>:wreath`.
 */
export function wreathLayout(year: number, salt = ""): WreathLayout {
  const rng = seasonRng({ season: "advent", year, screen: "wreath", salt }, "wreath");
  const durations = shuffle(FLAME_DURATIONS, rng);
  const candles: Candle[] = CANDLE_X.map((x, index) => ({
    index,
    x,
    y: ringFrontY(x),
    height: between(rng, 13, 16),
    lean: between(rng, -2.2, 2.2),
    flameDuration: Math.round((durations[index] + between(rng, -0.08, 0.08)) * 100) / 100,
    flameDelay: -Math.round(between(rng, 0, 2) * 100) / 100,
    flameAmp: Math.round(between(rng, 0.85, 1.2) * 100) / 100,
    glowDuration: Math.round(between(rng, 1.6, 2.6) * 100) / 100,
    wickGlow: Math.round(between(rng, 0.45, 1) * 100) / 100,
    dripSide: rng() < 0.5 ? -1 : 1,
    dripLength: Math.round(between(rng, 0.6, 1.4) * 100) / 100,
    tint: pick(rng, WAX_TINTS),
  }));
  // Dicht besetzt: 34 Büschel, jedes mit vier bis fünf Nadeln nach außen und innen, ein Teil heller (Licht von oben).
  const clusters: Cluster[] = Array.from({ length: 34 }, (_, i) => {
    const angle = (i / 34) * 360 + between(rng, -5, 5);
    const light = rng() < 0.28;
    return {
      angle,
      front: Math.sin((angle * Math.PI) / 180) > 0.15,
      shade: light ? NEEDLE_LIGHT : pick(rng, NEEDLE_SHADES),
      swayDelay: -Math.round(between(rng, 0, 12) * 10) / 10,
      needles: Array.from({ length: 4 + Math.floor(rng() * 2) }, () => ({ length: between(rng, 3.5, 7), spread: between(rng, -45, 45), tilt: between(rng, -30, 30) })),
    };
  });
  const berries: Berry[] = Array.from({ length: 6 }, () => ({ angle: between(rng, 0, 360), inset: between(rng, 0.84, 0.98), radius: between(rng, 0.85, 1.15), turn: between(rng, 0, 120) }));
  const bows: Bow[] = [between(rng, 150, 200), between(rng, 330, 380) % 360].map((angle) => ({ angle, size: between(rng, 1.25, 1.5), tilt: between(rng, -18, 18) }));
  return { year, candles, clusters, berries, bows };
}

/** Wie weit eine Kerze schon heruntergebrannt ist und wie lang ihre Wachsspur - aus den Tagen seit ihrem Sonntag. */
export function candleBurn(candle: Pick<Candle, "dripLength">, daysLit: number | null | undefined): { burnDown: number; drip: number } {
  const days = Math.max(0, Math.min(28, Number(daysLit) || 0));
  return {
    burnDown: Math.round((days / 28) * BURN_DOWN * 100) / 100,
    drip: Math.round(candle.dripLength * Math.min(1, days / 21) * DRIP_LENGTH * 100) / 100,
  };
}

/** Die Tage, die jede brennende Kerze schon brennt (null für kalte). */
export function daysLitFor(sundays: string[] | null | undefined, candles: number, today: string): Array<number | null> {
  return (sundays || []).slice(0, 4).map((sunday, index) => (index < candles ? daysSince(sunday, today) : null));
}

/** Der Text zum Kranz: „2. Advent – noch 13 Tage bis Weihnachten“. */
export function adventLabel({ candles = 0, daysToChristmas = null }: { candles?: number; daysToChristmas?: number | null } = {}): string {
  const lit = Math.max(0, Math.min(4, Number(candles) || 0));
  if (daysToChristmas === 0 && lit >= 4) return "Heiligabend – alle vier Kerzen brennen";
  if (lit === 0) return "Bald ist Advent";
  const advent = `${lit}. Advent`;
  if (daysToChristmas === null || daysToChristmas === undefined) return advent;
  if (daysToChristmas === 1) return `${advent} – morgen ist Heiligabend`;
  return `${advent} – noch ${daysToChristmas} Tage bis Weihnachten`;
}

/** Eine Wachsspur an der Kerzenseite: ein schmaler Tropfen, der mit den Tagen länger wird. */
export function dripPath(x: number, y: number, length: number, side: number): string {
  const s = side < 0 ? -1 : 1;
  const l = Math.max(0.5, length);
  return [
    `M ${x} ${y}`,
    `c ${s * 1.0} ${(l * 0.35).toFixed(2)}, ${s * 1.0} ${(l * 0.7).toFixed(2)}, ${s * 0.45} ${l.toFixed(2)}`,
    `c ${-s * 0.25} ${(l * 0.12).toFixed(2)}, ${-s * 0.75} ${(l * 0.12).toFixed(2)}, ${-s * 1.0} 0`,
    `c ${-s * 0.15} ${(-l * 0.35).toFixed(2)}, ${s * 0.1} ${(-l * 0.7).toFixed(2)}, ${s * 0.55} ${(-l).toFixed(2)}`,
    "z",
  ].join(" ");
}
