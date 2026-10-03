// Die Geburtstagstorte (Vereinsgeburtstag B1 #749): zwei Stöcke in Vereinsfarben, oben weiß mit blauer Glasur, unten
// dunkel mit goldener; vorne die Zuckerplatte mit dem Maskottchen. Kerzen nach Jahren - bis zwölf einzeln im Kreis auf
// dem oberen Stock, darüber Zahlkerzen. Was je Jahr anders ist (Tropfen, Streusel, Kerzen), kommt aus dem Jahres-Seed:
// dieselbe Torte für alle im selben Jahr, im nächsten eine etwas andere. Reine Rechnung - das Bild baut index.jsx.
import { seasonRng } from "../rng";

/** Die Bühne der Torte in SVG-Einheiten. */
export const CAKE_VIEW = { width: 120, height: 104 };
export const TOP = { cx: 60, y: 40, rx: 28, ry: 5, height: 22 };
export const BOTTOM = { cx: 60, y: 62, rx: 42, ry: 7, height: 30 };
/** Wo die Zuckerplatte mit dem Maskottchen sitzt (Mitte, Halbmesser). */
export const PLATE = { cx: 60, cy: 78, r: 12 };
/** Bis zu so vielen Jahren einzelne Kerzen - darüber Zahlkerzen. */
export const MAX_CANDLES = 12;
export const CLUB = { cyan: "#29B6E8", gold: "#FFD700", white: "#f7f4ee" };

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Ein Punkt auf einer Ellipse (Winkel in Grad, 90 = vorne). */
function onEllipse(cx, cy, rx, ry, degrees) {
  const angle = (degrees * Math.PI) / 180;
  return { x: round(cx + rx * Math.cos(angle)), y: round(cy + ry * Math.sin(angle)) };
}

/** Wie eine Kerze flackert - wie beim Kranz je Kerze eigen (advent/flame.jsx). */
function flameLook(rng) {
  return {
    flameDuration: round(1.1 + rng() * 0.6),
    flameDelay: round(rng() * 1.2),
    flameAmp: round(0.7 + rng() * 0.6),
    glowDuration: round(1.6 + rng() * 1.2),
    wickGlow: round(0.55 + rng() * 0.35),
  };
}

/** Einzelkerzen im Kreis auf dem oberen Stock: hinten zuerst (für die Malreihenfolge), Höhe und Neigung je Kerze. */
export function candleRing(count, rng) {
  const n = Math.max(1, Math.min(MAX_CANDLES, Math.round(count)));
  const ring = { rx: n === 1 ? 0 : Math.min(21, 7 + n * 1.4), ry: n === 1 ? 0 : Math.min(3.2, 1.4 + n * 0.18) };
  const start = rng() * 360;
  return Array.from({ length: n }, (_, index) => {
    const at = onEllipse(TOP.cx, TOP.y, ring.rx, ring.ry, start + (index * 360) / n);
    return { index, x: at.x, base: at.y, height: round(9 + rng() * 2.4), lean: round((rng() - 0.5) * 6), stripe: index % 2 === 0 ? "cyan" : "gold", ...flameLook(rng) };
  }).sort((a, b) => a.base - b.base || a.x - b.x);
}

/** Zahlkerzen ab dreizehn Jahren: je Ziffer eine, nebeneinander auf dem oberen Stock. */
export function numberCandles(years, rng) {
  const digits = String(Math.max(0, Math.round(years)));
  const width = 13;
  const left = TOP.cx - ((digits.length - 1) * width) / 2;
  return [...digits].map((digit, index) => ({ index, digit, x: round(left + index * width), base: TOP.y + 1, height: 19, lean: round((rng() - 0.5) * 4), color: index % 2 === 0 ? "cyan" : "gold", ...flameLook(rng) }));
}

/** Glasur, die an der Vorderkante eines Stocks herabläuft: Tropfen verschiedener Länge, je Jahr anders. */
export function dripPath(tier, rng, count = 9) {
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

/** Streusel auf der Oberseite des oberen Stocks und vorne am unteren - klein, schräg, in Vereinsfarben und Rosa. */
export function sprinkles(rng, count = 22) {
  const colors = [CLUB.cyan, CLUB.gold, "#ffffff", "#ff4fa3"];
  return Array.from({ length: count }, (_, index) => {
    const onTop = index % 3 !== 0;
    const at = onTop
      ? onEllipse(TOP.cx, TOP.y, TOP.rx * (0.25 + rng() * 0.7), TOP.ry * (0.25 + rng() * 0.7), rng() * 360)
      : { x: round(BOTTOM.cx - BOTTOM.rx + 6 + rng() * (BOTTOM.rx * 2 - 12)), y: round(BOTTOM.y + 12 + rng() * (BOTTOM.height - 18)) };
    return { x: at.x, y: at.y, angle: Math.round(rng() * 180), color: colors[Math.floor(rng() * colors.length)] };
  }).filter((dot) => Math.hypot(dot.x - PLATE.cx, dot.y - PLATE.cy) > PLATE.r + 2);
}

/**
 * Die Torte eines Jahres: Kerzen (einzeln oder als Zahl), Glasur, Streusel - aus dem Jahres-Seed. `years` sind die
 * Jahre des Vereins, `year` das Kalenderjahr (Seed). Ohne Jahre (kein Gründungsdatum, Vorschau) eine Kerze.
 */
export function cakePlan(years, year) {
  // Ort „cake“ statt einer Route: die App rechnet mit demselben Seed (Screen „cake“) dieselbe Torte.
  const rng = seasonRng({ season: "club_birthday", year, route: "cake" }, "cake");
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

/** In welcher Reihenfolge die Kerzen angehen: von links nach rechts, mit `stepMs` Abstand. */
export function ignitionOrder(plan, stepMs = 220) {
  const items = plan.numbers ? plan.digits : plan.candles;
  return [...items].sort((a, b) => a.x - b.x).map((item, order) => ({ index: item.index, at: order * stepMs }));
}
