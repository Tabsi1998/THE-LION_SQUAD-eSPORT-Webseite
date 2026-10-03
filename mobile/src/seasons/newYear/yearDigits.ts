// Die Jahreszahl um 00:00 in der App (#853): dieselbe Rechnung wie im Web (frontend/src/seasons/newYear/yearDigits.js) -
// je Ziffer eine Rakete, ihre Funken fliegen in die Form der Ziffer, stehen kurz als Zahl und rieseln herab. Was je
// Bild läuft, trägt "worklet" (UI-Thread, Reanimated). Ein Fingerabdruck in beiden Tests hält die Rechnungen gleich.

import type { ColorName, Launch, Point, Size } from "./fireworks";

export const GLYPH_WIDTH = 0.6;
export const GLYPH_PITCH = 0.82;
/** Unter der Gruß-Karte bleiben: so viel Platz (pt) hält die Zahl oben frei. */
export const YEAR_CLEAR_TOP = 240;
export const YEAR_FORM = 0.7;
export const YEAR_HOLD = 2.6;
export const YEAR_TRICKLE = 0.7;
export const YEAR_FALL = 2.6;
export const YEAR_RISE = 1.35;
export const YEAR_STAGGER_MS = 160;
export const YEAR_SALVO_DELAY_MS = 4600;
export const YEAR_STARS = { min: 72, max: 150, share: 0.75 } as const;

export type YearStar = { tx: number; ty: number; size: number; color: ColorName; glitter: number; fall: number; vx: number };
export type CalmDot = { x: number; y: number; white: boolean };
type Stroke = Array<[number, number]>;

function round1(value: number): number {
  "worklet";
  return Math.round(value * 10) / 10;
}

function round2(value: number): number {
  "worklet";
  return Math.round(value * 100) / 100;
}

function round3(value: number): number {
  "worklet";
  return Math.round(value * 1000) / 1000;
}

function arc(cx: number, cy: number, rx: number, ry: number, from: number, to: number, steps: number): Stroke {
  const out: Stroke = [];
  for (let i = 0; i <= steps; i += 1) {
    const a = from + ((to - from) * i) / steps;
    out.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return out;
}

const PI = Math.PI;
const SIX: Stroke[] = [[...arc(0.52, 0.56, 0.46, 0.52, -PI / 2 - 0.15, -PI, 10), ...arc(0.31, 0.73, 0.26, 0.25, PI, -PI + 0.25, 28)]];

/** Die Striche je Ziffer (y nach unten) - wie im Web. */
export const DIGIT_STROKES: Record<string, Stroke[]> = {
  0: [arc(0.3, 0.5, 0.28, 0.48, -PI / 2, (3 * PI) / 2, 32)],
  1: [[[0.1, 0.2], [0.34, 0.02], [0.34, 0.98]]],
  2: [[...arc(0.3, 0.28, 0.27, 0.26, PI, 2 * PI + 0.55, 18), [0.03, 0.98], [0.59, 0.98]]],
  3: [[...arc(0.3, 0.26, 0.25, 0.24, PI + 0.45, 2.5 * PI + 0.25, 16), ...arc(0.3, 0.74, 0.28, 0.25, 1.5 * PI - 0.25, 2.5 * PI + 0.95, 18)]],
  4: [[[0.45, 0.98], [0.45, 0.02], [0.02, 0.7], [0.6, 0.7]]],
  5: [[[0.55, 0.02], [0.12, 0.02], [0.09, 0.47], ...arc(0.3, 0.69, 0.28, 0.29, 1.5 * PI - 0.75, 2.5 * PI + 0.95, 18)]],
  6: SIX,
  7: [[[0.02, 0.02], [0.58, 0.02], [0.22, 0.98]]],
  8: [arc(0.3, 0.26, 0.22, 0.24, -PI / 2, 1.5 * PI, 24), arc(0.3, 0.75, 0.27, 0.25, PI / 2, 2.5 * PI, 26)],
  9: SIX.map((stroke) => stroke.map(([x, y]) => [GLYPH_WIDTH - x, 1 - y] as [number, number])),
};

function strokeLength(stroke: Stroke): number {
  "worklet";
  let length = 0;
  for (let i = 1; i < stroke.length; i += 1) length += Math.hypot(stroke[i][0] - stroke[i - 1][0], stroke[i][1] - stroke[i - 1][1]);
  return length;
}

export function glyphLength(digit: string): number {
  "worklet";
  const strokes = DIGIT_STROKES[digit] || [];
  let sum = 0;
  for (const stroke of strokes) sum += strokeLength(stroke);
  return sum;
}

function pointAlong(stroke: Stroke, at: number): [number, number] {
  "worklet";
  let rest = at;
  for (let i = 1; i < stroke.length; i += 1) {
    const [x0, y0] = stroke[i - 1];
    const [x1, y1] = stroke[i];
    const piece = Math.hypot(x1 - x0, y1 - y0);
    if (rest <= piece || i === stroke.length - 1) {
      const t = piece > 0 ? Math.min(1, rest / piece) : 0;
      return [x0 + (x1 - x0) * t, y0 + (y1 - y0) * t];
    }
    rest -= piece;
  }
  return stroke[0];
}

/** `count` Punkte gleichmäßig auf den Strichen einer Ziffer, bezogen auf ihre Mitte - wie im Web. */
export function glyphPoints(digit: string, count: number): Array<[number, number]> {
  "worklet";
  const strokes = DIGIT_STROKES[digit] || [];
  const total = glyphLength(digit);
  if (!strokes.length || total <= 0 || count <= 0) return [];
  const out: Array<[number, number]> = [];
  for (const stroke of strokes) {
    const length = strokeLength(stroke);
    const first = stroke[0];
    const last = stroke[stroke.length - 1];
    const closed = Math.hypot(last[0] - first[0], last[1] - first[1]) < 1e-6;
    const n = Math.max(2, Math.round((count * length) / total));
    for (let i = 0; i < n; i += 1) {
      const at = closed ? (length * i) / n : (length * i) / (n - 1);
      const [x, y] = pointAlong(stroke, at);
      out.push([round3(x - GLYPH_WIDTH / 2), round3(y - 0.5)]);
    }
  }
  return out;
}

export function yearText(year: number | string | null | undefined): string {
  return String(year ?? "").replace(/[^0-9]/g, "").slice(0, 4);
}

export function yearStarCount(cap: number): number {
  "worklet";
  return Math.max(YEAR_STARS.min, Math.min(YEAR_STARS.max, Math.round((Number(cap) || 0) * YEAR_STARS.share)));
}

export function glyphCounts(text: string, total: number): number[] {
  "worklet";
  const lengths: number[] = [];
  let sum = 0;
  for (let i = 0; i < text.length; i += 1) {
    const length = glyphLength(text[i]);
    lengths.push(length);
    sum += length;
  }
  const whole = sum || 1;
  return lengths.map((length) => Math.max(10, Math.round((total * length) / whole)));
}

/** Wo eine Ziffer steht (pt) - wie im Web: mittig, 17 % der Höhe, höchstens 80 % der Breite, unter der Gruß-Karte. */
export function glyphSpot(slot: number, slots: number, size: Size): { x: number; y: number; height: number } {
  "worklet";
  const n = Math.max(1, Number(slots) || 1);
  const span = GLYPH_WIDTH + (n - 1) * GLYPH_PITCH;
  const height = Math.max(40, Math.min(size.height * 0.17, (size.width * 0.8) / span));
  const y = Math.max(size.height * 0.42, YEAR_CLEAR_TOP + height / 2);
  const x = size.width / 2 + ((Number(slot) || 0) - (n - 1) / 2) * GLYPH_PITCH * height;
  return { x: round1(x), y: round1(y), height: round1(height) };
}

export function isGlyph(launch: Pick<Launch, "glyph"> | null | undefined): boolean {
  "worklet";
  return typeof launch?.glyph === "string" && launch.glyph.length === 1;
}

/** Die Raketen der Jahreszahl um `at` (ms, Serverzeit) - wie im Web. */
export function yearLaunches(year: number | string | null | undefined, at: number): Launch[] {
  const text = yearText(year);
  return Array.from(text).map((glyph, slot): Launch => ({
    id: `salvo:year:${slot}`,
    at: at + slot * YEAR_STAGGER_MS,
    type: "peony",
    caliber: "large",
    glyph,
    text,
    slot,
    slots: text.length,
    x: 0.5,
    distance: 0.1,
    colors: ["gold", "white"],
    burstY: 0.42,
    rise: YEAR_RISE,
    drift: 0,
    pattern: "year",
  }));
}

/** Die Funken einer Ziffer - wie `yearStars` im Web. */
export function yearStars(launch: Launch, rng: () => number, size: Size, total: number = YEAR_STARS.max): YearStar[] {
  "worklet";
  const slot = launch.slot ?? 0;
  const spot = glyphSpot(slot, launch.slots ?? 1, size);
  const counts = glyphCounts(launch.text || launch.glyph || "", total);
  const points = glyphPoints(launch.glyph || "", counts[slot] || counts[0] || 0);
  const grain = Math.max(0.75, Math.min(1.2, Math.sqrt(spot.height / 150)));
  const out: YearStar[] = [];
  for (const [ux, uy] of points) {
    const size1 = 0.85 + rng() * (1.15 - 0.85);
    const white = rng() < 0.22;
    const glitter = rng() * (Math.PI * 2);
    const fall = rng() * YEAR_TRICKLE;
    const vx = -10 + rng() * 20;
    out.push({ tx: round1(ux * spot.height), ty: round1(uy * spot.height), size: round2(2 * grain * size1), color: white ? launch.colors[1] : launch.colors[0], glitter: round2(glitter), fall: round2(fall), vx: round2(vx) });
  }
  return out;
}

/** Wo ein Funke der Zahl nach `age` Sekunden steht - wie im Web. */
export function yearStarAt(star: Pick<YearStar, "tx" | "ty" | "fall" | "vx">, age: number, origin: Point, wind = 0): Point {
  "worklet";
  if (age < YEAR_FORM) {
    const p = 1 - (1 - Math.max(0, age) / YEAR_FORM) ** 3;
    return { x: round1(origin.x + star.tx * p), y: round1(origin.y + star.ty * p) };
  }
  const held = age - YEAR_FORM;
  const x = origin.x + star.tx + wind * held * 0.15;
  const y = origin.y + star.ty + 3 * held;
  const falling = held - YEAR_HOLD - star.fall;
  if (falling <= 0) return { x: round1(x), y: round1(y) };
  const k = 1.1;
  const decay = (1 - Math.exp(-k * falling)) / k;
  const terminal = 46 / k;
  return { x: round1(x + star.vx * decay + wind * falling * 0.6), y: round1(y + terminal * falling - terminal * decay) };
}

/** Wie hell ein Funke der Zahl ist - wie im Web. */
export function yearStarLight(star: Pick<YearStar, "fall" | "glitter">, age: number): { alpha: number; ember: number } {
  "worklet";
  if (age < 0) return { alpha: 0, ember: 0 };
  const falling = age - YEAR_FORM - YEAR_HOLD - star.fall;
  if (falling >= YEAR_FALL) return { alpha: 0, ember: 0 };
  let alpha = age < 0.08 ? 1 : 0.95;
  let ember = 0;
  if (falling > 0) {
    const q = falling / YEAR_FALL;
    alpha *= (1 - q) ** 1.2 * (0.6 + 0.4 * Math.abs(Math.sin(age * 30 + star.glitter)));
    ember = Math.min(1, q / 0.6);
  } else if (age >= YEAR_FORM) {
    alpha *= 0.82 + 0.18 * Math.abs(Math.sin(age * 9 + star.glitter));
  }
  return { alpha: round3(alpha), ember: round3(ember) };
}

export function yearDuration(launch: Pick<Launch, "rise">): number {
  "worklet";
  return round2(launch.rise + YEAR_FORM + YEAR_HOLD + YEAR_TRICKLE + YEAR_FALL + 0.2);
}

/** Die ruhige Zahl („dezent“, Bewegung reduzieren) - dieselben Punkte fertig geformt, wie im Web. */
export function calmYearDots(year: number | string | null | undefined, size: Size, total = 120): CalmDot[] {
  const text = yearText(year);
  const counts = glyphCounts(text, total);
  return Array.from(text).flatMap((digit, slot) => {
    const spot = glyphSpot(slot, text.length, size);
    return glyphPoints(digit, counts[slot]).map(([ux, uy], i) => ({ x: round1(spot.x + ux * spot.height), y: round1(spot.y + uy * spot.height), white: (slot * 7 + i) % 5 === 0 }));
  });
}
