// Der Adventkranz (S6, #637; W1, #727): vier Kerzen auf einem Ring aus Tannenzweigen, jede anders - eigene Höhe,
// leichte Neigung, eigene Flammenfrequenz und -stärke, eigenes Glimmen des Dochts, eigene Wachsspur. Alles kommt aus
// dem Jahres-Seed (C4): dieses Jahr immer derselbe Kranz, nächstes Jahr ein anderer. Reine Rechnung ohne React; die
// Anzeige liegt in index.jsx, die Animation in advent.css.

import { between, pick, seasonRng } from "../rng";
import { daysSince } from "./calendar";

/** Zeichenfläche des Kranzes (SVG-Einheiten). */
export const VIEW = { width: 76, height: 44 };
/** Der Ring, leicht von oben gesehen. */
export const RING = { cx: 38, cy: 31, rx: 31, ry: 8.5 };
/** Wo die vier Kerzen stehen (auf der vorderen Hälfte des Rings, damit man sie ganz sieht). */
export const CANDLE_X = [15, 30.5, 45.5, 61];
export const CANDLE_WIDTH = 5.2;
/** Flammen-Dauern: keine zwei Kerzen gleich (0,9/1,3/1,7 s aus #637 plus eine vierte). */
const FLAME_DURATIONS = [0.9, 1.3, 1.7, 1.1];
const NEEDLE_SHADES = ["#2f6b3a", "#3f8a4a", "#245a30", "#356f3f"];
const WAX_TINTS = ["#f6ead2", "#f3e4c8", "#f8eedb", "#f1e0c4"];
/** Wie weit eine Kerze in vier Wochen herunterbrennt und wie lang die Wachsspur wird (SVG-Einheiten). */
export const BURN_DOWN = 2.6;
export const DRIP_LENGTH = 7;

/** Ein Punkt auf dem Ring: Winkel 0 = rechts, 90 = vorne (unten im Bild). */
export function ringPoint(angleDeg, ring = RING) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: ring.cx + ring.rx * Math.cos(a), y: ring.cy + ring.ry * Math.sin(a) };
}

/** Die Höhe des vorderen Ringrands an einer Stelle x - dort steht die Kerze. */
export function ringFrontY(x, ring = RING) {
  const t = Math.max(-1, Math.min(1, (x - ring.cx) / ring.rx));
  return ring.cy + ring.ry * Math.sqrt(1 - t * t);
}

function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Der Kranz eines Jahres: Kerzen, Zweigbüschel (hinten und vorne), Beeren und Schleifen. `salt` ist frei
 * (Gerät, Tests); ohne Salz sehen alle denselben Kranz.
 */
export function wreathLayout(year, salt = "") {
  const rng = seasonRng({ season: "advent", year, route: "wreath", salt }, "wreath");
  const durations = shuffle(FLAME_DURATIONS, rng);
  const candles = CANDLE_X.map((x, index) => ({
    index,
    x,
    y: ringFrontY(x),
    height: between(rng, 12.5, 15),
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
  const clusters = Array.from({ length: 22 }, (_, i) => {
    const angle = (i / 22) * 360 + between(rng, -6, 6);
    return {
      angle,
      front: Math.sin((angle * Math.PI) / 180) > 0.15,
      shade: pick(rng, NEEDLE_SHADES),
      swayDelay: -Math.round(between(rng, 0, 12) * 10) / 10,
      needles: Array.from({ length: 3 + Math.floor(rng() * 2) }, () => ({ length: between(rng, 3, 5.5), spread: between(rng, -40, 40), tilt: between(rng, -25, 25) })),
    };
  });
  const berries = Array.from({ length: 6 }, () => ({ angle: between(rng, 0, 360), inset: between(rng, 0.82, 0.98), radius: between(rng, 0.9, 1.3) }));
  const bows = [between(rng, 150, 200), between(rng, 330, 380) % 360].map((angle) => ({ angle, size: between(rng, 0.85, 1.1), tilt: between(rng, -18, 18) }));
  return { year, candles, clusters, berries, bows };
}

/** Wie weit eine Kerze schon heruntergebrannt ist und wie lang ihre Wachsspur - aus den Tagen seit ihrem Sonntag. */
export function candleBurn(candle, daysLit) {
  const days = Math.max(0, Math.min(28, Number(daysLit) || 0));
  return {
    burnDown: Math.round((days / 28) * BURN_DOWN * 100) / 100,
    drip: Math.round(candle.dripLength * Math.min(1, days / 21) * DRIP_LENGTH * 100) / 100,
  };
}

/** Die Tage, die jede brennende Kerze schon brennt (null für kalte). */
export function daysLitFor(sundays, candles, today) {
  return (sundays || []).slice(0, 4).map((sunday, index) => (index < candles ? daysSince(sunday, today) : null));
}

/** Der Text zum Kranz: „2. Advent – noch 13 Tage bis Weihnachten“. */
export function adventLabel({ candles = 0, daysToChristmas = null } = {}) {
  const lit = Math.max(0, Math.min(4, Number(candles) || 0));
  if (daysToChristmas === 0 && lit >= 4) return "Heiligabend – alle vier Kerzen brennen";
  if (lit === 0) return "Bald ist Advent";
  const advent = `${lit}. Advent`;
  if (daysToChristmas === null || daysToChristmas === undefined) return advent;
  if (daysToChristmas === 1) return `${advent} – morgen ist Heiligabend`;
  return `${advent} – noch ${daysToChristmas} Tage bis Weihnachten`;
}
