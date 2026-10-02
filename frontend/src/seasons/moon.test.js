import { SYNODIC_DAYS, illumination, litPath, moonPhase } from "./moon";

// Mondphase (#658): echte Phase des Tages - Neumond 10.10.2026, Vollmond 26.10.2026, zu Halloween noch fast rund.

test("Phase trifft die bekannten Neu- und Vollmonde auf gut einen Tag (mittlere Rechnung)", () => {
  const near = (phase, target) => Math.min(Math.abs(phase - target), 1 - Math.abs(phase - target));
  expect(near(moonPhase(new Date(Date.UTC(2026, 9, 10, 16))), 0)).toBeLessThan(0.05);
  expect(near(moonPhase(new Date(Date.UTC(2026, 9, 26, 4))), 0.5)).toBeLessThan(0.05);
  expect(near(moonPhase(new Date(Date.UTC(2026, 10, 9, 7))), 0)).toBeLessThan(0.05);
  const halloween = moonPhase(new Date(Date.UTC(2026, 9, 31, 20)));
  expect(halloween).toBeGreaterThan(0.6);
  expect(illumination(halloween)).toBeGreaterThan(0.6);
  expect(SYNODIC_DAYS).toBeCloseTo(29.53, 2);
});

test("Beleuchtung: Neumond dunkel, Vollmond ganz, Halbmond halb", () => {
  expect(illumination(0)).toBeCloseTo(0);
  expect(illumination(0.5)).toBeCloseTo(1);
  expect(illumination(0.25)).toBeCloseTo(0.5);
  expect(illumination(0.75)).toBeCloseTo(0.5);
});

test("Pfad: zunehmend rechts hell, abnehmend links hell, bei Vollmond eine ganze Scheibe", () => {
  const waxing = litPath(0.25, 50, 50, 20);
  expect(waxing.startsWith("M 50 30 A 20 20 0 0 1 50 70")).toBe(true);
  const waning = litPath(0.75, 50, 50, 20);
  expect(waning.startsWith("M 50 30 A 20 20 0 0 0 50 70")).toBe(true);
  expect(litPath(0.5, 50, 50, 20)).toContain("A 20.00 20 0 0 1 50 30");
  expect(litPath(0.1, 50, 50, 20)).toContain("0 0 0 50 30");
});
