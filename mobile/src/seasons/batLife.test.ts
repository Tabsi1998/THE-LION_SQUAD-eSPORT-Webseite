import { KEYFRAMES, keyframes } from "./bats";
import { TEMPERAMENTS, alertEveryMs, approachPath, awayMs, flightDurationMs, hopPath, inView, restMs, rotationFrames, temperamentFor, wantsToRoam } from "./batLife";

// Fledermaus-Leben (A2): Temperamente mit Ruhe- und Abwesenheitszeiten, Bahnen für Anflug und Umzug als Bögen,
// Drehung entlang der Bahn, Dauer nach Länge, nur im Fenster.

function rngOf(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("Temperamente: Zeiten in ihren Spannen, Roamer ziehen meist um, Schläfrige fast nie", () => {
  expect(temperamentFor(() => 0)).toBe("sleepy");
  expect(temperamentFor(() => 0.99)).toBe("curious");
  expect(restMs("sleepy", () => 0)).toBe(240000);
  expect(restMs("roamer", () => 1)).toBe(150000);
  expect(awayMs("skittish", () => 0.5)).toBe(42500);
  expect(alertEveryMs("curious", () => 0)).toBe(45000);
  expect(wantsToRoam("roamer", () => 0.5)).toBe(true);
  expect(wantsToRoam("sleepy", () => 0.5)).toBe(false);
  expect(TEMPERAMENTS.roamer.wander).toBeGreaterThan(TEMPERAMENTS.sleepy.wander);
});

test("Anflug kommt vom Rand und endet am Platz, Umzug ist ein Bogen über beiden Plätzen", () => {
  const size = { width: 400, height: 800 };
  const approach = approachPath({ x: 300, y: 200 }, size, rngOf([0.2, 0.5, 0.5, 0.5]));
  expect(approach.p0.x).toBe(-90);
  expect(approach.p3).toEqual({ x: 300, y: 200 });
  expect(approach.facing).toBe(1);
  expect(approachPath({ x: 300, y: 200 }, size, rngOf([0.9, 0.5, 0.5, 0.5])).p0.x).toBe(490);
  const hop = hopPath({ x: 60, y: 300 }, { x: 320, y: 500 }, () => 0.5);
  expect(hop.p1.y).toBeLessThan(300);
  expect(hop.p2.y).toBeLessThan(300);
  expect(hop.p3).toEqual({ x: 320, y: 500 });
  expect(hop.facing).toBe(1);
  expect(hopPath({ x: 320, y: 300 }, { x: 60, y: 300 }, () => 0.5).facing).toBe(-1);
});

test("Dauer nach Länge, begrenzt; Drehung folgt der Nase und endet bei 0; Stützpunkte passen zusammen", () => {
  const short = hopPath({ x: 0, y: 0 }, { x: 40, y: 0 }, () => 0);
  const long = hopPath({ x: 0, y: 0 }, { x: 2000, y: 0 }, () => 0);
  expect(flightDurationMs(short)).toBe(1800);
  expect(flightDurationMs(long)).toBe(5000);
  const mid = hopPath({ x: 0, y: 0 }, { x: 300, y: 100 }, () => 0.5);
  expect(flightDurationMs(mid)).toBeGreaterThan(1800);
  expect(flightDurationMs(mid)).toBeLessThan(5000);
  const frames = rotationFrames(mid);
  expect(frames.length).toBe(KEYFRAMES + 1);
  expect(frames.length).toBe(keyframes(mid).input.length);
  expect(frames[frames.length - 1]).toBe(0);
  expect(frames.every((value) => Math.abs(value) <= 32)).toBe(true);
  expect(frames.some((value) => value < 0)).toBe(true);
  const rightDown = { p0: { x: 0, y: 0 }, p1: { x: 30, y: 30 }, p2: { x: 60, y: 60 }, p3: { x: 100, y: 100 }, facing: 1 as const };
  const leftUp = { p0: { x: 100, y: 100 }, p1: { x: 70, y: 70 }, p2: { x: 40, y: 40 }, p3: { x: 0, y: 0 }, facing: -1 as const };
  expect(rotationFrames(rightDown, 4)[2]).toBe(32);
  expect(rotationFrames(leftUp, 4)[2]).toBe(32);
});

test("im Fenster: mit Rand, außerhalb nicht", () => {
  const size = { width: 400, height: 800 };
  expect(inView({ x: 10, y: 10 }, size)).toBe(true);
  expect(inView({ x: -30, y: 10 }, size)).toBe(true);
  expect(inView({ x: 10, y: 900 }, size)).toBe(false);
});
