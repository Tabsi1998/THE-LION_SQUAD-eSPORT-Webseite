import { batCount, flightPath, formationOffset, keyframes, nextFlightDelaySeconds, planFlock, pointAt } from "./bats";

// Fledermäuse in der App (#636, #655, #658): wenige in ruhiger Größe, Abstand nachts kürzer, Formation, Stützpunkte.

function rngOf(values: number[]) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("Anzahl nach Stärke, Abstand nachts kürzer", () => {
  expect(batCount("normal", () => 0)).toBe(3);
  expect(batCount("normal", () => 0.99)).toBe(5);
  expect(batCount("full", () => 0.99)).toBe(6);
  expect(nextFlightDelaySeconds(false, () => 0)).toBe(60);
  expect(nextFlightDelaySeconds(false, () => 1)).toBe(150);
  expect(nextFlightDelaySeconds(true, () => 1)).toBeCloseTo(90);
});

test("Kurve von links nach rechts, Stützpunkte laufen von Anfang bis Ende", () => {
  const size = { width: 400, height: 800 };
  const path = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5, 0.5]));
  expect(path.p0.x).toBe(-90);
  expect(path.p3.x).toBe(490);
  expect(path.facing).toBe(1);
  expect(pointAt(path, 0)).toEqual(path.p0);
  const frames = keyframes(path, { x: 10, y: 0 });
  expect(frames.input[0]).toBe(0);
  expect(frames.input[frames.input.length - 1]).toBe(1);
  expect(frames.xs[0]).toBe(-80);
  expect(frames.input.length).toBe(frames.xs.length);
});

test("Formation: V hat Reihen, der Haufen streut; Plan ruhig und versetzt", () => {
  const v1 = formationOffset(1, "v", () => 0.5);
  const v2 = formationOffset(2, "v", () => 0.5);
  expect(v1.x).toBe(-30);
  expect(Math.sign(v1.y)).not.toBe(Math.sign(v2.y));
  expect(Math.abs(formationOffset(3, "loose", () => 0.95).x)).toBeGreaterThan(30);
  const plan = planFlock("full", () => 0.5);
  expect(plan.length).toBe(5);
  expect(plan.every((bat) => bat.scale >= 0.8 && bat.scale <= 1.3)).toBe(true);
  expect(new Set(plan.map((bat) => bat.durationMs)).size).toBe(1);
});
