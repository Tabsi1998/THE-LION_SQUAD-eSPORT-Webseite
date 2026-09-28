import { advanceFlock, batCount, createFlock, drawBat, flightPath, formationOffset, nextFlightDelay, pointAt } from "./bats";

// Fledermäuse (#635, #655): mehr und größer, Abstand nachts kürzer, Flug quer über den Bildschirm, in
// Formation oder als Haufen, am Ende fertig - und gezeichnet mit Rand und Augen.

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("Anzahl nach Stärke, Abstand nachts kürzer", () => {
  expect(batCount("normal", () => 0)).toBe(5);
  expect(batCount("normal", () => 0.99)).toBe(8);
  expect(batCount("full", () => 0)).toBe(9);
  expect(batCount("full", () => 0.99)).toBe(14);
  expect(nextFlightDelay(false, () => 0)).toBe(45);
  expect(nextFlightDelay(false, () => 1)).toBe(150);
  expect(nextFlightDelay(true, () => 1)).toBeCloseTo(90);
});

test("Flug von links nach rechts oder umgekehrt, ganz durch den Bildschirm", () => {
  const size = { width: 1000, height: 600 };
  const left = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5, 0.5]));
  expect(left.p0.x).toBe(-140);
  expect(left.p3.x).toBe(1140);
  expect(left.facing).toBe(1);
  const right = flightPath(size, rngOf([0.9, 0.5, 0.5, 0.5, 0.5]));
  expect(right.p0.x).toBe(1140);
  expect(right.facing).toBe(-1);
  expect(pointAt(left, 0)).toEqual(left.p0);
  expect(pointAt(left, 1)).toEqual(left.p3);
});

test("Formation: V hat Reihen, der Haufen streut", () => {
  const v1 = formationOffset(1, 6, "v", () => 0.5);
  const v2 = formationOffset(2, 6, "v", () => 0.5);
  expect(v1.x).toBe(-42);
  expect(v2.x).toBe(-42);
  expect(Math.sign(v1.y)).not.toBe(Math.sign(v2.y));
  const loose = formationOffset(3, 6, "loose", () => 0.9);
  expect(Math.abs(loose.x)).toBeGreaterThan(42);
});

test("Schwarm erscheint versetzt, ist groß, bewegt sich und ist am Ende fertig", () => {
  const flock = createFlock({ width: 1000, height: 600 }, "normal", () => 0.5);
  expect(flock.bats.length).toBe(7);
  expect(flock.bats.every((bat) => bat.scale >= 1.7)).toBe(true);
  expect(flock.done).toBe(false);
  const first = advanceFlock(flock, 0.3);
  expect(first.length).toBeGreaterThanOrEqual(1);
  const later = advanceFlock(flock, 3);
  expect(later.length).toBe(flock.bats.length);
  expect(later[0].x).not.toBe(first[0].x);
  advanceFlock(flock, 30);
  expect(flock.done).toBe(true);
  expect(advanceFlock(flock, 1)).toEqual([]);
});

test("Zeichnen: Flügel mit Rand, Körper, Ohren, Augen", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, name) => (["fillStyle", "strokeStyle", "lineWidth"].includes(name) ? "" : () => calls.push(name)) });
  drawBat(ctx, { x: 10, y: 20, scale: 2, flap: 0.5, facing: -1 });
  expect(calls[0]).toBe("save");
  expect(calls.filter((name) => name === "stroke").length).toBe(3);
  expect(calls.filter((name) => name === "fill").length).toBe(5);
  expect(calls[calls.length - 1]).toBe("restore");
});
