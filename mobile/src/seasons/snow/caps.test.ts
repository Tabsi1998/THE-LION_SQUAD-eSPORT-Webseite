import { OVERHANG, THICKNESS, capGrowth, capLevel, capPath, capThickness } from "./caps";

// Schneehauben (W3 #729) - dieselbe Rechnung wie im Web: Stufe vom Server, Tauen bei Plusgraden, Kontur und
// Wachstum aus dem Seed, Zapfen ab Stufe 2.

test("Stufe: aus dem Server, bei Plusgraden eine halbe oder ganze weniger, nie unter 0,5", () => {
  expect(capLevel({ stage: 2 })).toBe(2);
  expect(capLevel({ stage: 2, tempC: -4 })).toBe(2);
  expect(capLevel({ stage: 2, tempC: 1 })).toBe(1.5);
  expect(capLevel({ stage: 2, tempC: 5 })).toBe(1);
  expect(capLevel({ stage: 1, tempC: 5 })).toBe(0.5);
  expect(capLevel({ stage: 9 })).toBe(3);
  expect(capLevel({ stage: null, tempC: null })).toBe(1);
});

test("Dicke: je Stufe, halbe Stufen dazwischen, Wachstum je Kante aus dem Seed", () => {
  expect(capThickness(1)).toBe(THICKNESS[1]);
  expect(capThickness(2)).toBe(THICKNESS[2]);
  expect(capThickness(3)).toBe(THICKNESS[3]);
  expect(capThickness(1.5)).toBeCloseTo((THICKNESS[1] + THICKNESS[2]) / 2, 1);
  expect(capThickness(0.5)).toBe(2);
  expect(capThickness(2, 1.3)).toBeCloseTo(8.5, 1);
  const growth = capGrowth("2026:dashboard-hero");
  expect(growth).toBeGreaterThanOrEqual(0.7);
  expect(growth).toBeLessThanOrEqual(1.3);
  expect(capGrowth("2026:dashboard-hero")).toBe(growth);
  expect(capGrowth("2027:dashboard-hero")).not.toBe(growth);
});

test("Kontur: geschlossener Pfad über die Breite, Buckel aus dem Seed, Zapfen erst ab Stufe 2", () => {
  const one = capPath({ width: 320, thickness: 4, seed: "2026:a", level: 1 });
  expect(one.d.startsWith("M 0 ")).toBe(true);
  expect(one.d.endsWith(" Z")).toBe(true);
  expect(one.base).toBeCloseTo(4 + OVERHANG, 5);
  expect(one.height).toBeCloseTo(one.base + 0.5, 5);
  expect(one.d).toContain("L 320.0 ");
  const three = capPath({ width: 320, thickness: 9, seed: "2026:a", level: 3 });
  expect(three.height).toBeCloseTo(three.base + 8.5, 5);
  expect(three.d.length).toBeGreaterThan(one.d.length);
  expect(capPath({ width: 320, thickness: 9, seed: "2026:a", level: 3 }).d).toBe(three.d);
  expect(capPath({ width: 320, thickness: 9, seed: "2026:b", level: 3 }).d).not.toBe(three.d);
  expect(capPath({ width: 2, thickness: 0.2 }).d).toContain("L 8.0 ");
});
