import { advanceFlock, batCount, createFlock, drawBat, flightPath, nextFlightDelay, pointAt } from "./bats";

// Fledermäuse (#635): Anzahl nach Stärke, Abstand nachts kürzer, Flug quer über den Bildschirm, am Ende fertig.

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("Anzahl nach Stärke, Abstand nachts kürzer", () => {
  expect(batCount("normal", () => 0)).toBe(5);
  expect(batCount("normal", () => 0.99)).toBe(8);
  expect(batCount("full", () => 0)).toBe(8);
  expect(batCount("full", () => 0.99)).toBe(12);
  expect(nextFlightDelay(false, () => 0)).toBe(60);
  expect(nextFlightDelay(false, () => 1)).toBe(180);
  expect(nextFlightDelay(true, () => 1)).toBeCloseTo(108);
});

test("Flug von links nach rechts oder umgekehrt, ganz durch den Bildschirm", () => {
  const size = { width: 1000, height: 600 };
  const left = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5, 0.5]));
  expect(left.p0.x).toBe(-80);
  expect(left.p3.x).toBe(1080);
  expect(left.facing).toBe(1);
  const right = flightPath(size, rngOf([0.9, 0.5, 0.5, 0.5, 0.5]));
  expect(right.p0.x).toBe(1080);
  expect(right.facing).toBe(-1);
  expect(pointAt(left, 0)).toEqual(left.p0);
  expect(pointAt(left, 1)).toEqual(left.p3);
  const mid = pointAt(left, 0.5);
  expect(mid.x).toBeGreaterThan(0);
  expect(mid.x).toBeLessThan(1000);
});

test("Schwarm erscheint versetzt, bewegt sich und ist am Ende fertig", () => {
  const flock = createFlock({ width: 1000, height: 600 }, "normal", () => 0.5);
  expect(flock.bats.length).toBe(7);
  expect(flock.done).toBe(false);
  const first = advanceFlock(flock, 0.3);
  expect(first.length).toBeGreaterThanOrEqual(1);
  expect(first.length).toBeLessThan(flock.bats.length);
  const later = advanceFlock(flock, 3);
  expect(later.length).toBe(flock.bats.length);
  expect(later[0].x).not.toBe(first[0].x);
  advanceFlock(flock, 30);
  expect(flock.done).toBe(true);
  expect(advanceFlock(flock, 1)).toEqual([]);
});

test("Zeichnen nutzt nur Pfade und füllt", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, name) => (name === "fillStyle" ? "" : (...args) => calls.push([name, args])) });
  drawBat(ctx, { x: 10, y: 20, scale: 1, flap: 0.5, facing: -1 });
  const names = calls.map(([name]) => name);
  expect(names[0]).toBe("save");
  expect(names.filter((name) => name === "fill").length).toBe(3);
  expect(names[names.length - 1]).toBe("restore");
});
