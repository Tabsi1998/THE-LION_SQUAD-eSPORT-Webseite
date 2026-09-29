import { between, hashString, mulberry32, pick, screenRng, seasonRng, seasonSeed, seasonYear } from "./rng";

// Zufall je Screen (#655): derselbe Name liefert immer denselben Strom, ein anderer einen anderen.
// Jahres-Seed (C4, #724): Saison + Jahr + Screen (+ Salz) - ein Neustart ändert nichts, das nächste Jahr würfelt neu.

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

test("Saisonjahr: aus dem Serverbeginn, sonst aus der Uhr - Saisons über Silvester zählen zum Jahr ihres Beginns", () => {
  expect(seasonYear("halloween", new Date(2026, 9, 31, 20))).toBe(2026);
  expect(seasonYear("halloween", new Date(2027, 9, 1))).toBe(2027);
  expect(seasonYear("winter", new Date(2027, 0, 15))).toBe(2026);
  expect(seasonYear("winter", new Date(2026, 11, 1))).toBe(2026);
  expect(seasonYear("new_year", new Date(2027, 0, 1, 0, 30))).toBe(2026);
  expect(seasonYear("easter", new Date(2027, 3, 4))).toBe(2027);
  expect(seasonYear({ key: "winter", starts_at: "2027-12-01T00:00:00+01:00" }, new Date(2028, 1, 1))).toBe(2027);
  expect(seasonYear({ key: "halloween", starts_at: "" }, new Date(2026, 9, 5))).toBe(2026);
  expect(seasonYear(null, new Date(2026, 5, 5))).toBe(2026);
});

test("Jahres-Seed: gleich innerhalb eines Jahres, anders je Jahr, Saison, Screen und Salz - über mehrere Jahre", () => {
  const draw = (spec: Parameters<typeof seasonRng>[0], use = "layout") => {
    const rng = seasonRng(spec, use);
    return [rng(), rng(), rng()];
  };
  expect(seasonSeed({ season: "halloween", year: 2026, screen: "NewsList" })).toBe("halloween:2026:NewsList");
  expect(seasonSeed({ season: "halloween", year: 2026, screen: "NewsList", salt: "geraet" })).toBe("halloween:2026:NewsList:geraet");
  expect(seasonSeed({ season: { key: "winter", starts_at: "2026-12-01" }, screen: "Dashboard" })).toBe("winter:2026:Dashboard");
  expect(seasonSeed({ season: "halloween", year: 2026, screen: "" })).toBe("halloween:2026:Dashboard");
  const base = draw({ season: "halloween", year: 2026, screen: "NewsList" });
  expect(draw({ season: "halloween", year: 2026, screen: "NewsList" })).toEqual(base);
  const years = [2026, 2027, 2028, 2029, 2030].map((year) => draw({ season: "halloween", year, screen: "NewsList" }));
  expect(new Set(years.map((values) => values.join(","))).size).toBe(5);
  expect(draw({ season: "winter", year: 2026, screen: "NewsList" })).not.toEqual(base);
  expect(draw({ season: "halloween", year: 2026, screen: "Dashboard" })).not.toEqual(base);
  expect(draw({ season: "halloween", year: 2026, screen: "NewsList", salt: "x" })).not.toEqual(base);
  expect(draw({ season: "halloween", year: 2026, screen: "NewsList" }, "bats")).not.toEqual(base);
  // Rückwärtskompatibel: der Saison-Strom ist ein Screen-Strom mit der Saat als Name.
  const compat = screenRng("halloween:2026:NewsList", "layout");
  expect([compat(), compat(), compat()]).toEqual(base);
});
