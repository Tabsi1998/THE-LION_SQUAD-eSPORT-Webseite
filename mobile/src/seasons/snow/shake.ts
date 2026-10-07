import { hashString, mulberry32 } from "../rng";

// Schnee abschütteln in der App (Jahreszeiten IV, #1088): dieselbe Rechnung wie im Web
// (frontend/src/seasons/snow/shake.js). Wird eine Karte mit Schneehaube angetippt (Karten-Signal, ../cardLift.ts),
// lösen sich die Flocken in einer halben Sekunde vom Rand, fallen 60 bis 120 px mit leichtem Wind und verblassen. Die
// Haube bleibt zu etwa einem Fünftel liegen und wächst in rund 90 Sekunden nach - nur an dieser Karte. Reine Rechnung;
// die Anzeige liegt in SnowCap.tsx.

export const SHAKE = {
  /** So lange lösen sich die Flocken nacheinander vom Rand (ms). */
  detachMs: 500,
  /** So tief fallen sie (px), so weit trägt sie der Wind (px). */
  fall: [60, 120] as [number, number],
  drift: [6, 26] as [number, number],
  /** So lange dauert der Fall einer Flocke (ms). */
  fallMs: [900, 1400] as [number, number],
  /** So viel der Haube bleibt liegen. */
  keep: 0.2,
  /** So lange wächst sie nach (ms). */
  regrowMs: 90000,
  /** Eine Flocke je so viele px Haube, höchstens so viele je Karte. */
  spacing: 9,
  max: 36,
};

export type ShakeRun = { from: number; to: number };
export type ShakeFlake = { x: number; y: number; size: number; delay: number; fall: number; drift: number; dur: number };

const round = (value: number) => Math.round(value * 10) / 10;
const between = (rng: () => number, [lo, hi]: [number, number]) => lo + rng() * (hi - lo);

/**
 * Wie viel der Haube `elapsedMs` nach dem Abschütteln liegt (1 = voll): in der halben Sekunde fällt sie auf ein
 * Fünftel, dann wächst sie gleichmäßig nach.
 */
export function shakeLevel(elapsedMs: number): number {
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
export function shakeDone(elapsedMs: number): boolean {
  return Number(elapsedMs) >= SHAKE.detachMs + SHAKE.regrowMs;
}

/**
 * Die Flocken eines Abschüttelns: über die freien Stücke der Kante verteilt (`runs` in px ab der linken Ecke), jede mit
 * eigenem Start, Fall, Wind und Dauer. `thickness` ist die Dicke der Haube, `seed` macht jedes Abschütteln anders. Der
 * Wind weht für alle Flocken in eine Richtung (aus dem Seed), ein paar treibt es zurück.
 */
export function shakeFlakes({ runs = [], thickness = 6, seed = "shake" }: { runs?: ShakeRun[]; thickness?: number; seed?: string } = {}): ShakeFlake[] {
  const rng = mulberry32(hashString(`snowshake:${seed}`));
  const sign = rng() < 0.5 ? -1 : 1;
  const flakes: ShakeFlake[] = [];
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
export function shakeDuration(flakes: ShakeFlake[]): number {
  return flakes.reduce((longest, flake) => Math.max(longest, flake.delay + flake.dur), 0);
}
