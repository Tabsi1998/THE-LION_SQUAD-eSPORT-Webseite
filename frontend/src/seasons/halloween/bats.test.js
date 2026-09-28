import { MODES, advanceFlock, batCount, createFlock, drawBat, flightPath, formationOffset, nextFlightDelay, pointAt } from "./bats";

// Fledermäuse (#635, #658, Runde IV): wenige Silhouetten in ruhiger Größe, Abstand nachts kürzer; Bahnen in
// Seitenkoordinaten - quer durchs Fenster, Sturzflug unter die Unterkante, Aufstieg über den oberen Rand.

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

test("Quer: von links nach rechts oder umgekehrt, ganz durch den Bildschirm, in Seitenkoordinaten", () => {
  const size = { width: 1000, height: 600 };
  const view = { scrollY: 2000, pageHeight: 5000 };
  const left = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5, 0.5]), view, "across");
  expect(left.mode).toBe("across");
  expect(left.p0.x).toBe(-120);
  expect(left.p3.x).toBe(1120);
  expect(left.facing).toBe(1);
  expect(left.p0.y).toBeGreaterThanOrEqual(2000 + 600 * 0.08);
  expect(left.p0.y).toBeLessThanOrEqual(2000 + 600 * 0.36);
  const right = flightPath(size, rngOf([0.9, 0.5, 0.5, 0.5, 0.5]), view, "across");
  expect(right.p0.x).toBe(1120);
  expect(right.facing).toBe(-1);
  expect(pointAt(left, 0)).toEqual(left.p0);
  expect(pointAt(left, 1)).toEqual(left.p3);
});

test("Sturzflug: beginnt oben im Fenster und endet unter der Unterkante - man kann nachscrollen; Aufstieg umgekehrt", () => {
  const size = { width: 1000, height: 600 };
  const view = { scrollY: 800, pageHeight: 4000 };
  const dive = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5]), view, "dive");
  expect(dive.mode).toBe("dive");
  expect(dive.p0.y).toBeGreaterThanOrEqual(800);
  expect(dive.p0.y).toBeLessThanOrEqual(800 + 600 * 0.25);
  expect(dive.p3.y).toBeGreaterThan(800 + 600);
  expect(dive.p3.y).toBeLessThanOrEqual(4000 - 40);
  expect(dive.p3.x).toBeGreaterThan(0);
  expect(dive.p3.x).toBeLessThan(1000);
  const shortPage = flightPath(size, rngOf([0.1, 0.5, 0.5, 0.5]), { scrollY: 0, pageHeight: 700 }, "dive");
  expect(shortPage.p3.y).toBeLessThanOrEqual(700 - 40);
  const rise = flightPath(size, rngOf([0.9, 0.5, 0.5, 0.5]), view, "rise");
  expect(rise.mode).toBe("rise");
  expect(rise.p0.y).toBeGreaterThan(800 + 600);
  expect(rise.p3.y).toBeLessThan(800);
  expect(rise.p3.y).toBeGreaterThanOrEqual(-80);
  expect(MODES.filter((mode) => mode === "across").length).toBe(2);
  const auto = flightPath(size, rngOf([0.7, 0.5, 0.5, 0.5, 0.5]), view);
  expect(["across", "dive", "rise"]).toContain(auto.mode);
});

test("Staffel: jedes Tier versetzt, abwechselnd oben und unten", () => {
  const one = formationOffset(1, () => 0.5);
  const two = formationOffset(2, () => 0.5);
  expect(one.x).toBeLessThan(0);
  expect(Math.sign(one.y)).not.toBe(Math.sign(two.y));
  expect(formationOffset(3, () => 0.5).x).toBeLessThan(one.x);
});

test("Schwarm erscheint versetzt, bleibt in ruhiger Größe, bewegt sich und ist am Ende fertig", () => {
  const flock = createFlock({ width: 1000, height: 600 }, [3, 5], () => 0.5, { scrollY: 300, pageHeight: 3000 }, "across");
  expect(flock.bats.length).toBe(4);
  expect(flock.bats.every((bat) => bat.scale >= 0.85 && bat.scale <= 1.4)).toBe(true);
  expect(flock.done).toBe(false);
  const first = advanceFlock(flock, 0.3);
  expect(first.length).toBeGreaterThanOrEqual(1);
  expect(first[0].y).toBeGreaterThan(300);
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
