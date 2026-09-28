import { batCount, flightPath, keyframes, nextFlightDelaySeconds, planFlock, pointAt } from "./bats";

// Fledermäuse in der App (#636): weniger Tiere als im Web, Abstand nachts kürzer, Stützpunkte für Animated.

function rngOf(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("Anzahl nach Stärke, Abstand nachts kürzer", () => {
  expect(batCount("normal", () => 0)).toBe(3);
  expect(batCount("normal", () => 0.99)).toBe(4);
  expect(batCount("full", () => 0.99)).toBe(6);
  expect(nextFlightDelaySeconds(false, () => 0)).toBe(90);
  expect(nextFlightDelaySeconds(false, () => 1)).toBe(180);
  expect(nextFlightDelaySeconds(true, () => 1)).toBeCloseTo(108);
});

test("Kurve von links nach rechts, Stützpunkte laufen von Anfang bis Ende", () => {
  const size = { width: 400, height: 800 };
  const path = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5, 0.5]));
  expect(path.p0.x).toBe(-60);
  expect(path.p3.x).toBe(460);
  expect(path.facing).toBe(1);
  expect(pointAt(path, 0)).toEqual(path.p0);
  const frames = keyframes(path, { x: 10, y: 0 });
  expect(frames.input[0]).toBe(0);
  expect(frames.input[frames.input.length - 1]).toBe(1);
  expect(frames.xs[0]).toBe(-50);
  expect(frames.xs[frames.xs.length - 1]).toBe(470);
  expect(frames.input.length).toBe(frames.xs.length);
  expect(frames.input.length).toBe(frames.ys.length);
});

test("Plan: versetzte Starts, gleiche Dauer", () => {
  const plan = planFlock("full", () => 0.5);
  expect(plan.length).toBe(5);
  expect(plan[0].delayMs).toBeLessThan(plan[1].delayMs);
  expect(new Set(plan.map((bat) => bat.durationMs)).size).toBe(1);
  expect(plan[0].durationMs).toBe(7500);
});
