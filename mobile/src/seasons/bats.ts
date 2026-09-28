// Fledermäuse in der App (#636): dieselbe Logik wie im Web (frontend/src/seasons/halloween/bats.js),
// nur ohne Canvas - jede Fledermaus ist eine animierte View, die Kurve liefert Stützpunkte dafür.

export type Point = { x: number; y: number };
export type FlightPath = { p0: Point; p1: Point; p2: Point; p3: Point; facing: 1 | -1 };
export type Size = { width: number; height: number };

export const FLIGHT_MS: [number, number] = [6000, 9000];
export const KEYFRAMES = 24;

export function batCount(intensity: string, rng: () => number = Math.random): number {
  const [min, max] = intensity === "full" ? [4, 6] : [3, 4];
  return min + Math.floor(rng() * (max - min + 1));
}

/** Sekunden bis zum nächsten Flug: 90–180, nachts häufiger. */
export function nextFlightDelaySeconds(night: boolean, rng: () => number = Math.random): number {
  const base = 90 + rng() * 90;
  return night ? base * 0.6 : base;
}

export function flightPath(size: Size, rng: () => number = Math.random): FlightPath {
  const fromLeft = rng() < 0.5;
  const startX = fromLeft ? -60 : size.width + 60;
  const endX = fromLeft ? size.width + 60 : -60;
  const y0 = size.height * (0.1 + rng() * 0.3);
  const y3 = size.height * (0.1 + rng() * 0.3);
  return {
    p0: { x: startX, y: y0 },
    p1: { x: startX + (endX - startX) * 0.3, y: y0 - size.height * (0.08 + rng() * 0.12) },
    p2: { x: startX + (endX - startX) * 0.7, y: y3 + size.height * (0.04 + rng() * 0.12) },
    p3: { x: endX, y: y3 },
    facing: fromLeft ? 1 : -1,
  };
}

export function pointAt(path: FlightPath, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * u * path.p0.x + 3 * u * u * t * path.p1.x + 3 * u * t * t * path.p2.x + t * t * t * path.p3.x,
    y: u * u * u * path.p0.y + 3 * u * u * t * path.p1.y + 3 * u * t * t * path.p2.y + t * t * t * path.p3.y,
  };
}

/** Stützpunkte für Animated.interpolate: inputRange 0..1 in KEYFRAMES Schritten, outputRange x bzw. y. */
export function keyframes(path: FlightPath, offset: Point = { x: 0, y: 0 }): { input: number[]; xs: number[]; ys: number[] } {
  const input: number[] = [];
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i <= KEYFRAMES; i += 1) {
    const t = i / KEYFRAMES;
    const point = pointAt(path, t);
    input.push(t);
    xs.push(point.x + offset.x);
    ys.push(point.y + offset.y + Math.sin(t * Math.PI * 6) * 5);
  }
  return { input, xs, ys };
}

export type BatPlan = { delayMs: number; offset: Point; scale: number; durationMs: number };

export function planFlock(intensity: string, rng: () => number = Math.random): BatPlan[] {
  const count = batCount(intensity, rng);
  const durationMs = FLIGHT_MS[0] + rng() * (FLIGHT_MS[1] - FLIGHT_MS[0]);
  return Array.from({ length: count }, (_, index) => ({
    delayMs: index * 220 + rng() * 400,
    offset: { x: (rng() - 0.5) * 80, y: (rng() - 0.5) * 60 },
    scale: 0.7 + rng() * 0.5,
    durationMs,
  }));
}
