// Gewitter in der App (#771) - dieselbe Rechnung wie im Web (`frontend/src/seasons/weather/storm.js`): meldet das
// Wetter am Vereinsort ein Gewitter, leuchtet es - selten, kurz, leise. Ein Wetterleuchten ist ein weicher Schein im
// oberen Teil des Bildschirms mit einem oder zwei Pulsen, manchmal mit einem feinen Blitz in der Ferne. Zwischen zwei
// Blitzen liegen mindestens acht Sekunden, ein Blitz hat höchstens zwei Pulse (weit unter drei Blitzen je Sekunde),
// der Schein bleibt unter 14 % Deckkraft. Bei „Bewegung reduzieren“ gibt es die Ebene gar nicht.

import type { Size, WeatherLike } from "../snow/flakes";

export type Point = { x: number; y: number };
export type Bolt = { main: Point[]; branches: Point[][] };
export type Flash = { startedAt: number; top: number; x: number; strength: number; pulses: number; bolt: Bolt | null };

/** Pause zwischen zwei Blitzen (s), Länge eines Pulses (s), Abstand des zweiten Pulses (s). */
export const FLASH_GAP: [number, number] = [8, 25];
export const PULSE = { rise: 0.04, fall: 0.2, second: 0.15 };
export const FLASH_SECONDS = PULSE.second + PULSE.rise + PULSE.fall;
/** Höchste Deckkraft von Schein und Blitz. */
export const GLOW_ALPHA = 0.14;
export const BOLT_ALPHA = 0.42;
/** Wie weit der Schein nach unten reicht (Anteil der Höhe) und wie tief ein Blitz höchstens geht. */
export const GLOW_REACH = 0.5;
export const BOLT_REACH: [number, number] = [0.22, 0.42];

/** Meldet das Wetter ein Gewitter? Open-Meteo: 95 Gewitter, 96 und 99 mit Hagel. */
export function isThunderstorm(weather: (WeatherLike & { code?: number | null; stale?: boolean | null }) | null | undefined): boolean {
  if (!weather || weather.stale) return false;
  const code = Number(weather.code);
  return Number.isFinite(code) && code >= 95 && code <= 99;
}

/** Wann der nächste Blitz kommt (Sekunden auf der Uhr der Ebene). */
export function nextFlashAt(rng: () => number, now = 0): number {
  return now + FLASH_GAP[0] + rng() * (FLASH_GAP[1] - FLASH_GAP[0]);
}

/** Der Weg eines Blitzes: vom oberen Rand in Zacken nach unten, mit ein, zwei kurzen Ästen. */
export function boltPath(rng: () => number, size: Size, top = 0): Bolt {
  const startX = size.width * (0.12 + rng() * 0.76);
  const depth = size.height * (BOLT_REACH[0] + rng() * (BOLT_REACH[1] - BOLT_REACH[0]));
  const steps = 6 + Math.floor(rng() * 5);
  const main: Point[] = [{ x: startX, y: top }];
  for (let i = 1; i <= steps; i += 1) {
    const previous = main[i - 1];
    main.push({ x: previous.x + (rng() - 0.5) * 46, y: top + (depth * i) / steps });
  }
  const branches: Point[][] = [];
  const count = 1 + Math.floor(rng() * 2);
  for (let n = 0; n < count; n += 1) {
    const from = main[2 + Math.floor(rng() * Math.max(1, steps - 3))];
    const side = rng() < 0.5 ? -1 : 1;
    const branch: Point[] = [from];
    for (let i = 1; i <= 3; i += 1) branch.push({ x: from.x + side * i * (10 + rng() * 14), y: from.y + i * (8 + rng() * 12) });
    branches.push(branch);
  }
  return { main, branches };
}

/** Ein Blitz: wo der Schein sitzt, wie hell er wird, ein oder zwei Pulse, mit oder ohne sichtbaren Blitz. */
export function createFlash(rng: () => number, size: Size, startedAt = 0, top = 0): Flash {
  const withBolt = rng() < 0.4;
  const bolt = withBolt ? boltPath(rng, size, top) : null;
  return {
    startedAt,
    top,
    x: bolt ? bolt.main[0].x : size.width * (0.1 + rng() * 0.8),
    strength: 0.6 + rng() * 0.4,
    pulses: rng() < 0.55 ? 2 : 1,
    bolt,
  };
}

function pulseAt(age: number): number {
  "worklet";
  if (age < 0) return 0;
  if (age < PULSE.rise) return age / PULSE.rise;
  if (age < PULSE.rise + PULSE.fall) return 1 - (age - PULSE.rise) / PULSE.fall;
  return 0;
}

/** Wie hell der Blitz gerade ist (0–1): erster Puls voll, der zweite schwächer. Danach 0 - der Blitz ist vorbei. */
export function flashLevel(flash: Pick<Flash, "startedAt" | "pulses" | "strength">, t: number): number {
  "worklet";
  const age = t - flash.startedAt;
  if (age < 0 || age > FLASH_SECONDS) return 0;
  const first = pulseAt(age);
  const second = flash.pulses > 1 ? pulseAt(age - PULSE.second) * 0.6 : 0;
  return Math.min(1, Math.max(first, second)) * flash.strength;
}

/** Ist der Blitz vorbei? */
export function flashDone(flash: Pick<Flash, "startedAt">, t: number): boolean {
  return t - flash.startedAt > FLASH_SECONDS;
}
