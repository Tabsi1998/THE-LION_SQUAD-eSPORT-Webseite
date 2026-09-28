import { advanceFlock, batCount, createFlock, drawBat, flightPath, formationOffset, nextFlightDelay, pointAt } from "./bats";

// Fledermäuse (#635, #658): wenige Silhouetten in ruhiger Größe, Abstand nachts kürzer, Flug quer über den
// Bildschirm in loser Staffel, am Ende fertig.

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("Anzahl nach Stärke, Abstand 60–180 Sekunden, nachts kürzer", () => {
  expect(batCount([3, 5], () => 0)).toBe(3);
  expect(batCount([3, 5], () => 0.99)).toBe(5);
  expect(batCount("full", () => 0)).toBe(5);
  expect(batCount("full", () => 0.99)).toBe(8);
  expect(nextFlightDelay(false, () => 0)).toBe(60);
  expect(nextFlightDelay(false, () => 1)).toBe(180);
  expect(nextFlightDelay(true, () => 1)).toBeCloseTo(126);
});

test("Flug von links nach rechts oder umgekehrt, ganz durch den Bildschirm", () => {
  const size = { width: 1000, height: 600 };
  const left = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5, 0.5]));
  expect(left.p0.x).toBe(-120);
  expect(left.p3.x).toBe(1120);
  expect(left.facing).toBe(1);
  const right = flightPath(size, rngOf([0.9, 0.5, 0.5, 0.5, 0.5]));
  expect(right.p0.x).toBe(1120);
  expect(right.facing).toBe(-1);
  expect(pointAt(left, 0)).toEqual(left.p0);
  expect(pointAt(left, 1)).toEqual(left.p3);
});

test("Staffel: jedes Tier versetzt, abwechselnd oben und unten", () => {
  const one = formationOffset(1, () => 0.5);
  const two = formationOffset(2, () => 0.5);
  expect(one.x).toBeLessThan(0);
  expect(Math.sign(one.y)).not.toBe(Math.sign(two.y));
  expect(formationOffset(3, () => 0.5).x).toBeLessThan(one.x);
});

test("Schwarm erscheint versetzt, bleibt in ruhiger Größe, bewegt sich und ist am Ende fertig", () => {
  const flock = createFlock({ width: 1000, height: 600 }, [3, 5], () => 0.5);
  expect(flock.bats.length).toBe(4);
  expect(flock.bats.every((bat) => bat.scale >= 0.85 && bat.scale <= 1.4)).toBe(true);
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

test("Zeichnen: Körper und zwei Flügel als Silhouette mit feinem Rand", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, name) => (["fillStyle", "strokeStyle", "lineWidth"].includes(name) ? "" : () => calls.push(name)) });
  drawBat(ctx, { x: 10, y: 20, scale: 1, flap: 0.5, facing: -1 });
  expect(calls[0]).toBe("save");
  expect(calls.filter((name) => name === "fill").length).toBe(3);
  expect(calls.filter((name) => name === "stroke").length).toBe(2);
  expect(calls[calls.length - 1]).toBe("restore");
});
