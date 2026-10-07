// Schnee abschütteln (Jahreszeiten IV, #1088): Hebt sich eine Karte mit Schneehaube (Karten-Signal, ../cardLift.js),
// lösen sich die Flocken in einer halben Sekunde vom Rand, fallen 60 bis 120 px mit leichtem Wind und verblassen. Die
// Haube bleibt zu etwa einem Fünftel liegen, fährt mit der Karte und wächst in rund 90 Sekunden nach - nur an dieser
// Karte, Nachbarn behalten ihren Schnee. Reine Rechnung; die Anzeige liegt in SnowCaps.jsx (Fall und Nachwachsen als
// CSS in snow.css). Die App rechnet dasselbe (mobile/src/seasons/snow/shake.ts).

import { hashString, mulberry32 } from "../rng";

export const SHAKE = {
  /** So lange lösen sich die Flocken nacheinander vom Rand (ms). */
  detachMs: 500,
  /** So tief fallen sie (px), so weit trägt sie der Wind (px). */
  fall: [60, 120],
  drift: [6, 26],
  /** So lange dauert der Fall einer Flocke (ms). */
  fallMs: [900, 1400],
  /** So viel der Haube bleibt liegen. */
  keep: 0.2,
  /** So lange wächst sie nach (ms). */
  regrowMs: 90000,
  /** Eine Flocke je so viele px Haube, höchstens so viele je Karte. */
  spacing: 9,
  max: 36,
};

const round = (value) => Math.round(value * 10) / 10;
const between = (rng, [lo, hi]) => lo + rng() * (hi - lo);

/**
 * Wie viel der Haube `elapsedMs` nach dem Abschütteln liegt (1 = voll): in der halben Sekunde fällt sie auf ein
 * Fünftel, dann wächst sie gleichmäßig nach. Für Tests und die App; im Web macht CSS dieselbe Kurve.
 */
export function shakeLevel(elapsedMs) {
  const t = Math.max(0, Number(elapsedMs) || 0);
  if (t <= SHAKE.detachMs) {
    const p = t / SHAKE.detachMs;
    const eased = 1 - (1 - p) * (1 - p);
    return round((1 - (1 - SHAKE.keep) * eased) * 1000) / 1000;
  }
  const grow = Math.min(1, (t - SHAKE.detachMs) / SHAKE.regrowMs);
  return round((SHAKE.keep + (1 - SHAKE.keep) * grow) * 1000) / 1000;
}

/** Ist das Abschütteln samt Nachwachsen vorbei? */
export function shakeDone(elapsedMs) {
  return Number(elapsedMs) >= SHAKE.detachMs + SHAKE.regrowMs;
}

/**
 * Die Flocken eines Abschüttelns: über die freien Stücke der Kante verteilt (`runs` in px ab der linken Ecke),
 * jede mit eigenem Start, Fall, Wind und Dauer. `thickness` ist die Dicke der Haube, `seed` macht jedes Abschütteln
 * anders. Der Wind weht für alle Flocken in eine Richtung (aus dem Seed), ein paar treibt es zurück.
 */
export function shakeFlakes({ runs = [], thickness = 6, seed = "shake" } = {}) {
  const rng = mulberry32(hashString(`snowshake:${seed}`));
  const sign = rng() < 0.5 ? -1 : 1;
  const flakes = [];
  for (const run of runs) {
    const width = Math.max(0, run.to - run.from);
    if (width < 8) continue;
    const count = Math.max(2, Math.round(width / SHAKE.spacing));
    for (let i = 0; i < count && flakes.length < SHAKE.max; i += 1) {
      const x = run.from + (i + 0.5) * (width / count) + (rng() - 0.5) * 4;
      flakes.push({
        x: round(Math.min(run.to, Math.max(run.from, x))),
        y: round(-rng() * thickness * 0.8),
        size: round(1.6 + rng() * 2.2),
        delay: Math.round(rng() * SHAKE.detachMs),
        fall: Math.round(between(rng, SHAKE.fall)),
        drift: Math.round(between(rng, SHAKE.drift) * sign * (rng() < 0.15 ? -0.4 : 1)),
        dur: Math.round(between(rng, SHAKE.fallMs)),
      });
    }
  }
  return flakes;
}

/** Wann die letzte Flocke weg ist (ms) - danach kann die Ebene der Flocken verschwinden. */
export function shakeDuration(flakes) {
  return flakes.reduce((longest, flake) => Math.max(longest, flake.delay + flake.dur), 0);
}
