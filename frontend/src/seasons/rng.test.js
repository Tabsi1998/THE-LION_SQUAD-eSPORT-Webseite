import { between, hashString, mulberry32, pageRng, pick, seasonRng, seasonSeed, seasonYear } from "./rng";

// Zufall je Seite (#655): dieselbe Adresse liefert immer denselben Strom, eine andere Adresse einen anderen.
// Jahres-Seed (C4, #724): Saison + Jahr + Route (+ Salz) - ein Neuladen ändert nichts, das nächste Jahr würfelt neu.

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

test("Saisonjahr: aus dem Serverbeginn, sonst aus der Uhr - Saisons über Silvester zählen zum Jahr ihres Beginns", () => {
  expect(seasonYear("halloween", new Date(2026, 9, 31, 20))).toBe(2026);
  expect(seasonYear("halloween", new Date(2027, 9, 1))).toBe(2027);
  expect(seasonYear("winter", new Date(2027, 0, 15))).toBe(2026);
  expect(seasonYear("winter", new Date(2026, 11, 1))).toBe(2026);
  expect(seasonYear("new_year", new Date(2027, 0, 1, 0, 30))).toBe(2026);
  expect(seasonYear("snow", new Date(2027, 0, 6))).toBe(2026);
  expect(seasonYear("advent_calendar", new Date(2027, 0, 3))).toBe(2026);
  expect(seasonYear("easter", new Date(2027, 3, 4))).toBe(2027);
  expect(seasonYear({ key: "winter", starts_at: "2027-12-01T00:00:00+01:00" }, new Date(2028, 1, 1))).toBe(2027);
  expect(seasonYear({ key: "halloween", starts_at: "" }, new Date(2026, 9, 5))).toBe(2026);
  expect(seasonYear(null, new Date(2026, 5, 5))).toBe(2026);
});

test("Jahres-Seed: gleich innerhalb eines Jahres, anders je Jahr, Saison, Route und Salz - über mehrere Jahre", () => {
  const draw = (spec, use = "layout") => {
    const rng = seasonRng(spec, use);
    return [rng(), rng(), rng()];
  };
  expect(seasonSeed({ season: "halloween", year: 2026, route: "/news" })).toBe("halloween:2026:/news");
  expect(seasonSeed({ season: "halloween", year: 2026, route: "/news", salt: "geraet" })).toBe("halloween:2026:/news:geraet");
  expect(seasonSeed({ season: { key: "winter", starts_at: "2026-12-01" }, route: "/" })).toBe("winter:2026:/");
  expect(seasonSeed({ season: "halloween", year: 2026, route: "" })).toBe("halloween:2026:/");
  const base = draw({ season: "halloween", year: 2026, route: "/news" });
  expect(draw({ season: "halloween", year: 2026, route: "/news" })).toEqual(base);
  const years = [2026, 2027, 2028, 2029, 2030].map((year) => draw({ season: "halloween", year, route: "/news" }));
  expect(new Set(years.map((values) => values.join(","))).size).toBe(5);
  expect(draw({ season: "winter", year: 2026, route: "/news" })).not.toEqual(base);
  expect(draw({ season: "halloween", year: 2026, route: "/events" })).not.toEqual(base);
  expect(draw({ season: "halloween", year: 2026, route: "/news", salt: "x" })).not.toEqual(base);
  expect(draw({ season: "halloween", year: 2026, route: "/news" }, "bats")).not.toEqual(base);
  // Rückwärtskompatibel: der Saison-Strom ist ein Seiten-Strom mit der Saat als Adresse.
  const compat = pageRng("halloween:2026:/news", "layout");
  expect([compat(), compat(), compat()]).toEqual(base);
});
