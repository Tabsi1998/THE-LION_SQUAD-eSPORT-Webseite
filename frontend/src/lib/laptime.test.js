import { formatLapTime, parseLapTime } from "./laptime";

// Zielzeit je Strecke (#613): Text ↔ Millisekunden, tolerant bei Komma und fehlenden Stellen, streng bei Unsinn.

test("parseLapTime: Minuten, Sekunden, Tausendstel - mit Punkt oder Komma, auch ohne Minuten", () => {
  expect(parseLapTime("1:32.450")).toBe(92450);
  expect(parseLapTime("1:32,45")).toBe(92450);
  expect(parseLapTime("1:32")).toBe(92000);
  expect(parseLapTime("92.45")).toBe(92450);
  expect(parseLapTime("  0:59.9 ")).toBe(59900);
  expect(parseLapTime("125")).toBe(125000);
});

test("parseLapTime: leer ist keine Zielzeit, Unsinn ist NaN", () => {
  expect(parseLapTime("")).toBeNull();
  expect(parseLapTime(null)).toBeNull();
  expect(Number.isNaN(parseLapTime("schnell"))).toBe(true);
  expect(Number.isNaN(parseLapTime("1:75.000"))).toBe(true);
  expect(Number.isNaN(parseLapTime("1:2:3"))).toBe(true);
});

test("formatLapTime: m:ss.mmm, leer ohne Wert", () => {
  expect(formatLapTime(92450)).toBe("1:32.450");
  expect(formatLapTime(59900)).toBe("0:59.900");
  expect(formatLapTime(0)).toBe("0:00.000");
  expect(formatLapTime(null)).toBe("");
  expect(formatLapTime(undefined)).toBe("");
  expect(parseLapTime(formatLapTime(725123))).toBe(725123);
});
