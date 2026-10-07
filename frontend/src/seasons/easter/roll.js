// Ein Osterei auf der Kante einer Karte (Jahreszeiten IV, Variante B, #1092): Neben der Reihe unter der Kopfzeile liegt
// auf der Oberkante einiger Karten ein bemaltes Ei auf der Seite, daneben ein Grasbüschel. Hebt sich die Karte, wackelt
// das Ei zweimal, rollt höchstens sechs Pixel zur näheren Ecke und bleibt dort liegen - nie über die Ecke hinaus, kein
// Ei fällt von der Karte. Ist kein Platz mehr, wackelt es nur. Reine Rechnung; die Anzeige liegt in CardEggs.jsx (die
// Keyframes in easter.css folgen ROLL), die App rechnet dasselbe (mobile/src/seasons/easter/roll.ts, Paritätstest).

import { hashString, mulberry32 } from "../rng";
import { PATTERN_NAMES } from "../easterHunt/EggShape";

export const ROLL = {
  /** So lange dauert alles (ms): erst wackeln, dann rollen. */
  ms: 1080,
  /** Bis zu diesem Bruchteil der Zeit wackelt es, danach rollt es. */
  split: 0.48,
  /** So weit kippt es beim Wackeln (Grad). */
  wobble: 9,
  /** So weit rollt es höchstens je Anheben (px), so nah an die Ecke darf seine Mitte höchstens (px). */
  maxPx: 6,
  margin: 14,
  /** So weit dreht es sich beim Rollen nach vorn (Grad, bei vollen sechs Pixeln), bevor es sich wieder hinlegt. */
  turn: 28,
  /** Wackeln: [Bruchteil der Zeit, Neigung als Bruchteil von `wobble`] - zweimal hin und her. */
  wobbleKeys: [[0, 0], [0.12, -1], [0.24, 0.89], [0.36, -0.56], [0.48, 0]],
  /** Rollen: [Bruchteil der Zeit, Drehung als Bruchteil von `turn`, Weg als Bruchteil der Strecke]. */
  rollKeys: [[0.48, 0, 0], [0.7, 1, 0.62], [0.86, -0.21, 1], [0.94, 0.07, 1], [1, 0, 1]],
};

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Wie hoch ein liegendes Ei über der Kante ist (halbe Höhe, px): ein Oval, um `lean` Grad gekippt. */
export function lyingHalf(size, lean) {
  const angle = (Math.abs(lean) * Math.PI) / 180;
  const a = size * 0.45;
  const b = size * 0.592;
  return round(Math.sqrt((a * Math.sin(angle)) ** 2 + (b * Math.cos(angle)) ** 2), 2);
}

/**
 * Das Ei einer Karte: wo es auf der Kante liegt (`x`, px ab der linken Ecke), wie groß, welches Muster, wie weit auf
 * die Seite gekippt (`lean`), wohin es rollt (`dir` -1 links, 1 rechts - zur näheren Ecke) und wie weit es insgesamt
 * rollen darf (`room`), dazu das Grasbüschel auf der anderen Seite. Aus der Saat - je Karte und Jahr fest.
 */
export function cardEggPlan(width, seed = "egg") {
  const rng = mulberry32(hashString(`cardegg:${seed}`));
  const left = rng() < 0.5;
  const fraction = left ? 0.1 + rng() * 0.24 : 0.66 + rng() * 0.24;
  const size = round(12.5 + rng() * 2.5);
  const pattern = PATTERN_NAMES[Math.floor(rng() * PATTERN_NAMES.length)];
  const lean = round((rng() < 0.5 ? -1 : 1) * (66 + rng() * 14));
  const x = round(width * fraction);
  const dir = left ? -1 : 1;
  const room = round(Math.max(0, dir < 0 ? x - ROLL.margin : width - ROLL.margin - x));
  const tuft = { x: round(x - dir * (size * 0.95 + 3)), width: round(12 + rng() * 5), height: round(8 + rng() * 3), blades: 4 + Math.floor(rng() * 2) };
  return { x, size, pattern, lean, dir, room, half: lyingHalf(size, lean), tuft };
}

/** Ein Anheben: wohin das Ei jetzt rollt (Versatz in px ab seinem Platz) - höchstens 6 px weiter, nie über `room`. */
export function rollStep(offset, plan) {
  const done = Math.abs(Number(offset) || 0);
  const step = Math.max(0, Math.min(ROLL.maxPx, plan.room - done));
  return round((Number(offset) || 0) + plan.dir * step);
}

/** Der Kasten (px, ab der linken Ecke, y nach oben negativ), den Ei und Gras auf ihrem ganzen Weg brauchen. */
export function eggBox(plan) {
  const reach = plan.size * 0.66;
  const end = plan.x + plan.dir * plan.room;
  const left = Math.min(plan.x, end, plan.tuft.x - plan.tuft.width / 2) - reach;
  const right = Math.max(plan.x, end, plan.tuft.x + plan.tuft.width / 2) + reach;
  return { left: round(left), right: round(right), top: round(-(plan.half * 2 + 2)), bottom: 0 };
}

function track(keys, t, column) {
  const at = Math.max(keys[0][0], Math.min(1, t));
  for (let i = 1; i < keys.length; i += 1) {
    const [t0] = keys[i - 1];
    const [t1] = keys[i];
    if (at <= t1) return keys[i - 1][column] + ((at - t0) / (t1 - t0)) * (keys[i][column] - keys[i - 1][column]);
  }
  return keys[keys.length - 1][column];
}

/**
 * Die Haltung zur Zeit `ms` (für Tests und die App; im Web machen es die Keyframes): Neigung in Grad (Wackeln, dann die
 * Drehung beim Rollen) und Weg in px von `from` nach `to`.
 */
export function rollPose(ms, from, to, dir) {
  const t = Math.max(0, Math.min(1, (Number(ms) || 0) / ROLL.ms));
  const share = Math.min(1, Math.abs(to - from) / ROLL.maxPx);
  const angle = t <= ROLL.split ? track(ROLL.wobbleKeys, t, 1) * ROLL.wobble : track(ROLL.rollKeys, t, 1) * ROLL.turn * share * dir;
  const way = t <= ROLL.split ? 0 : track(ROLL.rollKeys, t, 2);
  return { angle: round(angle, 2) || 0, x: round(from + (to - from) * way, 2) || 0 };
}
