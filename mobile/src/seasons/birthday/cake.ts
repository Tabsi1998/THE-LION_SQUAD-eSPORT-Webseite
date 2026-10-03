// Die Geburtstagstorte in der App (Vereinsgeburtstag B1 #749), dieselbe Rechnung wie im Web
// (frontend/src/seasons/birthday/cake.js; Abgleich im Test): zwei Stöcke in Vereinsfarben, vorne die Zuckerplatte mit
// dem Maskottchen, Kerzen nach Jahren - bis zwölf einzeln im Kreis, darüber Zahlkerzen. Was je Jahr anders ist, kommt
// aus dem Jahres-Seed (Ort „cake“, wie im Web). Reine Rechnung - das Bild baut BirthdayCake.tsx.
import { seasonRng } from "../rng";

export const CAKE_VIEW = { width: 120, height: 104 };
export const TOP = { cx: 60, y: 40, rx: 28, ry: 5, height: 22 };
export const BOTTOM = { cx: 60, y: 62, rx: 42, ry: 7, height: 30 };
export const PLATE = { cx: 60, cy: 78, r: 12 };
export const MAX_CANDLES = 12;
export const CLUB = { cyan: "#29B6E8", gold: "#FFD700", white: "#f7f4ee" };

type Rng = () => number;
type Tier = { cx: number; y: number; rx: number; ry: number; height: number };
type FlameLook = { flameDuration: number; flameDelay: number; flameAmp: number; glowDuration: number; wickGlow: number };
export type CakeCandle = { index: number; x: number; base: number; height: number; lean: number; stripe: "cyan" | "gold" } & FlameLook;
export type DigitCandle = { index: number; digit: string; x: number; base: number; height: number; lean: number; color: "cyan" | "gold" } & FlameLook;
export type Sprinkle = { x: number; y: number; angle: number; color: string };
export type CakePlan = { years: number; numbers: boolean; candles: CakeCandle[]; digits: DigitCandle[]; topDrips: string; bottomDrips: string; sprinkles: Sprinkle[]; band: "dots" | "zigzag" };

const round = (value: number, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

function onEllipse(cx: number, cy: number, rx: number, ry: number, degrees: number): { x: number; y: number } {
  const angle = (degrees * Math.PI) / 180;
  return { x: round(cx + rx * Math.cos(angle)), y: round(cy + ry * Math.sin(angle)) };
}

function flameLook(rng: Rng): FlameLook {
  return {
    flameDuration: round(1.1 + rng() * 0.6),
    flameDelay: round(rng() * 1.2),
    flameAmp: round(0.7 + rng() * 0.6),
    glowDuration: round(1.6 + rng() * 1.2),
    wickGlow: round(0.55 + rng() * 0.35),
  };
}

export function candleRing(count: number, rng: Rng): CakeCandle[] {
  const n = Math.max(1, Math.min(MAX_CANDLES, Math.round(count)));
  const ring = { rx: n === 1 ? 0 : Math.min(21, 7 + n * 1.4), ry: n === 1 ? 0 : Math.min(3.2, 1.4 + n * 0.18) };
  const start = rng() * 360;
  return Array.from({ length: n }, (_, index): CakeCandle => {
    const at = onEllipse(TOP.cx, TOP.y, ring.rx, ring.ry, start + (index * 360) / n);
    return { index, x: at.x, base: at.y, height: round(9 + rng() * 2.4), lean: round((rng() - 0.5) * 6), stripe: index % 2 === 0 ? "cyan" : "gold", ...flameLook(rng) };
  }).sort((a, b) => a.base - b.base || a.x - b.x);
}

export function numberCandles(years: number, rng: Rng): DigitCandle[] {
  const digits = String(Math.max(0, Math.round(years)));
  const width = 13;
  const left = TOP.cx - ((digits.length - 1) * width) / 2;
  return [...digits].map((digit, index): DigitCandle => ({ index, digit, x: round(left + index * width), base: TOP.y + 1, height: 19, lean: round((rng() - 0.5) * 4), color: index % 2 === 0 ? "cyan" : "gold", ...flameLook(rng) }));
}

export function dripPath(tier: Tier, rng: Rng, count = 9): string {
  const left = tier.cx - tier.rx;
  const step = (tier.rx * 2) / count;
  let d = `M ${round(left)} ${tier.y}`;
  for (let i = 0; i < count; i += 1) {
    const x0 = left + i * step;
    const front = onEllipse(tier.cx, tier.y, tier.rx, tier.ry, 180 - ((i + 0.5) / count) * 180);
    const drop = round(2 + rng() * (tier.height * 0.32));
    d += ` Q ${round(x0 + step * 0.15)} ${round(front.y + 1)} ${round(x0 + step * 0.3)} ${round(front.y + drop * 0.6)}`;
    d += ` Q ${round(x0 + step * 0.5)} ${round(front.y + drop + 2)} ${round(x0 + step * 0.7)} ${round(front.y + drop * 0.6)}`;
    d += ` Q ${round(x0 + step * 0.85)} ${round(front.y + 1)} ${round(x0 + step)} ${round(onEllipse(tier.cx, tier.y, tier.rx, tier.ry, 180 - ((i + 1) / count) * 180).y)}`;
  }
  return `${d} L ${round(tier.cx + tier.rx)} ${round(tier.y - 0.5)} A ${tier.rx} ${tier.ry} 0 0 0 ${round(left)} ${round(tier.y - 0.5)} Z`;
}

export function sprinkles(rng: Rng, count = 22): Sprinkle[] {
  const colors = [CLUB.cyan, CLUB.gold, "#ffffff", "#ff4fa3"];
  return Array.from({ length: count }, (_, index): Sprinkle => {
    const onTop = index % 3 !== 0;
    const at = onTop
      ? onEllipse(TOP.cx, TOP.y, TOP.rx * (0.25 + rng() * 0.7), TOP.ry * (0.25 + rng() * 0.7), rng() * 360)
      : { x: round(BOTTOM.cx - BOTTOM.rx + 6 + rng() * (BOTTOM.rx * 2 - 12)), y: round(BOTTOM.y + 12 + rng() * (BOTTOM.height - 18)) };
    return { x: at.x, y: at.y, angle: Math.round(rng() * 180), color: colors[Math.floor(rng() * colors.length)] };
  }).filter((dot) => Math.hypot(dot.x - PLATE.cx, dot.y - PLATE.cy) > PLATE.r + 2);
}

/** Die Torte eines Jahres - `years` Jahre des Vereins, `year` das Kalenderjahr (Seed). Ohne Jahre eine Kerze. */
export function cakePlan(years: number | null | undefined, year: number): CakePlan {
  const rng = seasonRng({ season: "club_birthday", year, screen: "cake" }, "cake");
  const count = Number.isFinite(Number(years)) && Number(years) > 0 ? Math.round(Number(years)) : 1;
  const numbers = count > MAX_CANDLES;
  return {
    years: count,
    numbers,
    candles: numbers ? [] : candleRing(count, rng),
    digits: numbers ? numberCandles(count, rng) : [],
    topDrips: dripPath(TOP, rng, 8),
    bottomDrips: dripPath(BOTTOM, rng, 11),
    sprinkles: sprinkles(rng),
    band: rng() < 0.5 ? "dots" : "zigzag",
  };
}

/** Von links nach rechts, mit `stepMs` Abstand. */
export function ignitionOrder(plan: CakePlan, stepMs = 220): Array<{ index: number; at: number }> {
  const items: Array<{ index: number; x: number }> = plan.numbers ? plan.digits : plan.candles;
  return [...items].sort((a, b) => a.x - b.x).map((item, order) => ({ index: item.index, at: order * stepMs }));
}
