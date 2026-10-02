// Lichterkette (Jahreszeiten II S8, #639; Weihnachten X1, #734; App S11, #642): dieselbe Rechnung wie im Web
// (frontend/src/seasons/christmas/lights.js) - ein Draht, der an Nägeln hängt und zwischen ihnen durchhängt, daran
// Lämpchen in Vereinsfarben und warmem Weiß, keine zwei gleich: eigene Helligkeit, eigenes Aufglimmen (Dauer und
// Versatz), ein paar flackern selten. Alles aus dem Jahres-Seed (C4): dieses Jahr immer dieselbe Kette. Ein
// Paritätstest auf beiden Seiten (`lights.test.ts`, `lights.test.js`) hält die zwei Rechnungen gleich. Reine Rechnung;
// die Anzeige liegt in LightChain.tsx.

import { between, seasonRng } from "../rng";

/** Das Band, in dem die Kette hängt (Punkte). */
export const BAND_HEIGHT = 18;
export const INSET = 12;
/** Der Schein um ein Lämpchen: Vielfaches seines Radius und die größte Ausdehnung. */
export const GLOW_FACTOR = 2.1;
export const GLOW = 7;
/** Die Kopfzeile trägt die Kette in ihren untersten 16 Punkten - in der App die Begrüßungskarte im Dashboard. */
export const HEADER_BAND = 16;
/** Farben: Vereinsblau, warmes Weiß, Gold, ein Hauch Rot, kaltes Weiß. */
export const COLORS = { blue: "#29B6E8", warm: "#ffd9a0", gold: "#ffc857", red: "#e8453c", white: "#eef7ff" } as const;
export type BulbColor = keyof typeof COLORS;
/** Wie oft welche Farbe vorkommt - das Blau des Vereins führt, warmes Weiß trägt, Gold und Rot setzen Akzente. */
const PALETTE: BulbColor[] = ["blue", "warm", "blue", "gold", "warm", "blue", "red", "warm", "white"];

export type Segment = { from: number; to: number; sag: number };
export type Gap = [number, number];
export type Bulb = {
  index: number;
  segment: number;
  x: number;
  y: number;
  wire: number;
  color: BulbColor;
  radius: number;
  brightness: number;
  glowDuration: number;
  glowDelay: number;
  flicker: boolean;
  flickerDelay: number;
};
export type ChainLayout = { width: number; height: number; nails: number[]; segments: Segment[]; bulbs: Bulb[]; wire: string };

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Die Höhe des Drahts an der Stelle t (0–1) eines Abschnitts mit Durchhang `sag`: eine Parabel. */
export function wireY(t: number, sag: number, top = 1): number {
  return top + 4 * sag * t * (1 - t);
}

/** Der Draht als SVG-Pfad: je Abschnitt eine Kurve durch den tiefsten Punkt. */
export function wirePath(segments: Segment[], top = 1): string {
  if (!segments.length) return "";
  let d = `M ${segments[0].from.toFixed(1)} ${top}`;
  segments.forEach((segment) => {
    const mid = (segment.from + segment.to) / 2;
    d += ` Q ${mid.toFixed(1)} ${(top + 2 * segment.sag).toFixed(1)} ${segment.to.toFixed(1)} ${top}`;
  });
  return d;
}

/** Liegt x in einer Lücke? */
export function inGap(x: number, gaps: Gap[] = []): boolean {
  return gaps.some(([from, to]) => x >= from && x <= to);
}

export type ChainSpec = { width: number; year: number | string; salt?: string; anchor?: string; height?: number; gaps?: Gap[] };

/**
 * Die Kette über eine Breite: Nägel alle 190–260 Punkte (mit Versatz), Abschnitte mit eigenem Durchhang, Lämpchen alle
 * 52–70 Punkte mit eigener Farbe (nie zweimal dieselbe nebeneinander), Größe, Helligkeit, Glimmen und seltenem
 * Flackern. `anchor` trennt die Ketten im Seed; `gaps` sind x-Bereiche ohne Lämpchen.
 */
export function chainLayout({ width, year, salt = "", anchor = "header", height = BAND_HEIGHT, gaps = [] }: ChainSpec): ChainLayout {
  // Im Web heißt der dritte Teil der Saat `route`, in der App `screen` - dieselbe Saat: christmas:<Jahr>:lights:<Anker>.
  const rng = seasonRng({ season: "christmas", year, screen: `lights:${anchor}`, salt }, "chain");
  const span = Math.max(0, width - INSET * 2);
  if (span < 120) return { width, height, nails: [], segments: [], bulbs: [], wire: "" };
  const count = Math.max(2, Math.round(span / between(rng, 190, 260)) + 1);
  const nails = Array.from({ length: count }, (_, i) => {
    const base = INSET + (span * i) / (count - 1);
    return i === 0 || i === count - 1 ? base : base + between(rng, -12, 12);
  });
  const maxSag = (height - 8) * 0.9;
  const segments: Segment[] = nails.slice(1).map((to, i) => ({ from: nails[i], to, sag: between(rng, maxSag * 0.6, maxSag) }));
  const order = shuffle(PALETTE, rng);
  let paletteIndex = 0;
  let lastColor: BulbColor | null = null;
  const nextColor = (): BulbColor => {
    let color = order[paletteIndex % order.length];
    paletteIndex += 1;
    if (color === lastColor) {
      color = order[paletteIndex % order.length];
      paletteIndex += 1;
    }
    lastColor = color;
    return color;
  };
  const bulbs: Bulb[] = [];
  segments.forEach((segment, segmentIndex) => {
    const length = segment.to - segment.from;
    const perSegment = Math.max(1, Math.round(length / between(rng, 52, 70)));
    for (let n = 0; n < perSegment; n += 1) {
      const t = (n + 1) / (perSegment + 1) + between(rng, -0.04, 0.04);
      const x = segment.from + length * t;
      const wire = wireY(t, segment.sag);
      // Alle Zufallszahlen werden immer gezogen, damit eine Lücke die anderen Lämpchen nicht verändert.
      const bulb: Bulb = {
        index: bulbs.length,
        segment: segmentIndex,
        x: Math.round(x * 10) / 10,
        y: Math.round((wire + 3.6) * 10) / 10,
        wire: Math.round(wire * 10) / 10,
        color: nextColor(),
        radius: Math.round(between(rng, 2.5, 3.3) * 10) / 10,
        brightness: Math.round(between(rng, 0.7, 1) * 100) / 100,
        glowDuration: Math.round(between(rng, 2.6, 6) * 10) / 10,
        glowDelay: -Math.round(between(rng, 0, 6) * 10) / 10,
        flicker: rng() < 0.18,
        flickerDelay: Math.round(between(rng, 3, 17) * 10) / 10,
      };
      if (!inGap(bulb.x, gaps)) bulbs.push(bulb);
    }
  });
  return { width, height, nails, segments, bulbs, wire: wirePath(segments) };
}

/** Der Schein eines Lämpchens (Radius) - wie im Web: ein Vielfaches seines Radius, höchstens GLOW. */
export function glowRadius(bulb: Pick<Bulb, "radius">): number {
  return Math.min(GLOW, bulb.radius * GLOW_FACTOR);
}
