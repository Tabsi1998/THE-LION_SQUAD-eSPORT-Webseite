import { between, hashString, mulberry32, pick, screenRng } from "./rng";

// Zufall je Screen (#655): derselbe Name liefert immer denselben Strom, ein anderer einen anderen.

test("Saat aus dem Screen-Namen ist stabil und verschieden", () => {
  expect(hashString("Dashboard")).toBe(hashString("Dashboard"));
  expect(hashString("Dashboard")).not.toBe(hashString("Tournaments"));
  const a = screenRng("Dashboard", "halloween");
  const b = screenRng("Dashboard", "halloween");
  const c = screenRng("Tournaments", "halloween");
  const first = [a(), a(), a()];
  expect([b(), b(), b()]).toEqual(first);
  expect([c(), c(), c()]).not.toEqual(first);
});

test("Werte im Bereich, Auswahl aus der Liste", () => {
  const rng = mulberry32(3);
  for (let i = 0; i < 100; i += 1) {
    const value = rng();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  }
  const range = between(mulberry32(5), 4, 8);
  expect(range).toBeGreaterThanOrEqual(4);
  expect(range).toBeLessThan(8);
  expect(["x", "y"]).toContain(pick(mulberry32(1), ["x", "y"]));
});
