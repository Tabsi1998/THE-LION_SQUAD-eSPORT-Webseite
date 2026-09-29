// Fledermaus-Leben in der App (A2, #716 - wie H8/H9 im Web, aber ereignisgetrieben statt je Bild): Temperamente,
// Ruhezeiten, Bahnen für Flucht, Anflug und Umzug, Drehung entlang der Bahn. Die Phasen (perched → alert → takeoff
// → flying/approaching → landing → settle) laufen als Zeitgeber und Animated-Sequenzen in anchors.tsx und
// halloween.tsx; hier steht nur die Rechnung, damit sie deterministisch prüfbar bleibt.

import { pointAt, type FlightPath, type Point, type Size } from "./bats";

export type Temperament = "sleepy" | "skittish" | "roamer" | "curious";
export type TemperamentSpec = { restMs: [number, number]; awayMs: [number, number]; alertEveryMs: [number, number]; wander: number };

export const TEMPERAMENTS: Record<Temperament, TemperamentSpec> = {
  sleepy: { restMs: [240000, 480000], awayMs: [45000, 90000], alertEveryMs: [180000, 360000], wander: 0.1 },
  skittish: { restMs: [120000, 300000], awayMs: [25000, 60000], alertEveryMs: [40000, 120000], wander: 0.3 },
  roamer: { restMs: [60000, 150000], awayMs: [20000, 45000], alertEveryMs: [90000, 200000], wander: 0.85 },
  curious: { restMs: [150000, 360000], awayMs: [30000, 70000], alertEveryMs: [45000, 140000], wander: 0.3 },
};
export const TEMPERAMENT_KEYS = Object.keys(TEMPERAMENTS) as Temperament[];
export const TAKEOFF_MS = 450;
export const SETTLE_MS = 700;
export const ALERT_MS = 1200;
export const MAX_ROTATION = 32;

function between(rng: () => number, [min, max]: [number, number]): number {
  return Math.round(min + rng() * (max - min));
}

export function temperamentFor(rng: () => number): Temperament {
  return TEMPERAMENT_KEYS[Math.floor(rng() * TEMPERAMENT_KEYS.length) % TEMPERAMENT_KEYS.length];
}

/** Ruhe auf dem Platz, bis etwas passiert (Umzug bei Unruhigen, sonst nur Dösen). */
export function restMs(temperament: Temperament, rng: () => number): number {
  return between(rng, (TEMPERAMENTS[temperament] || TEMPERAMENTS.sleepy).restMs);
}

/** Wie lange eine verscheuchte Fledermaus fort bleibt, bevor sie einen neuen Platz sucht. */
export function awayMs(temperament: Temperament, rng: () => number): number {
  return between(rng, (TEMPERAMENTS[temperament] || TEMPERAMENTS.sleepy).awayMs);
}

/** Abstand zwischen zwei kurzen Aufmerksamkeits-Momenten (Kopf heben, Flügel zucken) - ohne Haptik. */
export function alertEveryMs(temperament: Temperament, rng: () => number): number {
  return between(rng, (TEMPERAMENTS[temperament] || TEMPERAMENTS.sleepy).alertEveryMs);
}

/** Zieht die Fledermaus nach der Ruhe um? Unruhige (Roamer) meist, Schläfrige fast nie. */
export function wantsToRoam(temperament: Temperament, rng: () => number): boolean {
  return rng() < (TEMPERAMENTS[temperament] || TEMPERAMENTS.sleepy).wander;
}

/** Anflug von außerhalb des Fensters zu einem Platz: weit ausholend, mit Bogen, am Ende abbremsend (Fensterkoordinaten). */
export function approachPath(target: Point, size: Size, rng: () => number): FlightPath {
  const fromLeft = rng() < 0.5;
  const start = { x: fromLeft ? -90 : size.width + 90, y: size.height * (0.12 + rng() * 0.45) };
  const dx = target.x - start.x;
  return {
    p0: start,
    p1: { x: start.x + dx * 0.35, y: start.y - 70 - rng() * 70 },
    p2: { x: target.x - dx * 0.12, y: target.y - 50 - rng() * 40 },
    p3: { x: target.x, y: target.y },
    facing: fromLeft ? 1 : -1,
  };
}

/** Umzug von Platz zu Platz: ein Bogen mit Höhe, nie eine Gerade. */
export function hopPath(from: Point, to: Point, rng: () => number): FlightPath {
  const dx = to.x - from.x;
  const lift = 70 + rng() * 110;
  const top = Math.min(from.y, to.y);
  return {
    p0: { x: from.x, y: from.y },
    p1: { x: from.x + dx * 0.3, y: top - lift },
    p2: { x: from.x + dx * 0.7, y: top - lift * 0.6 },
    p3: { x: to.x, y: to.y },
    facing: dx >= 0 ? 1 : -1,
  };
}

/** Dauer eines Flugs nach der Länge der Bahn: 1,8–5 s. */
export function flightDurationMs(path: FlightPath): number {
  let length = 0;
  let last = pointAt(path, 0);
  for (let i = 1; i <= 16; i += 1) {
    const point = pointAt(path, i / 16);
    length += Math.hypot(point.x - last.x, point.y - last.y);
    last = point;
  }
  return Math.round(Math.max(1800, Math.min(5000, 1200 + length * 3.8)));
}

/**
 * Drehung der Nase entlang der Bahn je Stützpunkt (Grad, gespiegelte Figur relativ zur linken Achse), am Ende 0 -
 * für `Animated.interpolate` mit derselben `input`-Reihe wie `keyframes`.
 */
export function rotationFrames(path: FlightPath, count = 24): number[] {
  const frames: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    const t = i / count;
    if (i === count) {
      frames.push(0);
      break;
    }
    const here = pointAt(path, t);
    const ahead = pointAt(path, Math.min(1, t + 0.02));
    const angle = (Math.atan2(ahead.y - here.y, ahead.x - here.x) * 180) / Math.PI;
    const relative = (((path.facing >= 0 ? angle : angle - 180) + 540) % 360) - 180;
    frames.push(Math.round(Math.max(-MAX_ROTATION, Math.min(MAX_ROTATION, relative)) * 10) / 10);
  }
  return frames;
}

/** Liegt der Punkt im Fenster (mit Rand)? Flüge zu Plätzen außerhalb des sichtbaren Screens gibt es nicht. */
export function inView(point: Point, size: Size, margin = 40): boolean {
  return point.x >= -margin && point.x <= size.width + margin && point.y >= -margin && point.y <= size.height + margin;
}
