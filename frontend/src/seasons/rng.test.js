import { between, hashString, mulberry32, pageRng, pick } from "./rng";

// Zufall je Seite (#655): dieselbe Adresse liefert immer denselben Strom, eine andere Adresse einen anderen.

test("Saat aus der Adresse ist stabil und verschieden", () => {
  expect(hashString("/news")).toBe(hashString("/news"));
  expect(hashString("/news")).not.toBe(hashString("/events"));
  const a = pageRng("/news", "halloween");
  const b = pageRng("/news", "halloween");
  const c = pageRng("/events", "halloween");
  const d = pageRng("/news", "bats");
  const first = [a(), a(), a()];
  expect([b(), b(), b()]).toEqual(first);
  expect([c(), c(), c()]).not.toEqual(first);
  expect([d(), d(), d()]).not.toEqual(first);
});

test("Werte bleiben im Bereich, Auswahl trifft nur Listenelemente", () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 200; i += 1) {
    const value = rng();
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThan(1);
  }
  const range = between(mulberry32(7), 10, 20);
  expect(range).toBeGreaterThanOrEqual(10);
  expect(range).toBeLessThan(20);
  expect(["a", "b", "c"]).toContain(pick(mulberry32(9), ["a", "b", "c"]));
});
