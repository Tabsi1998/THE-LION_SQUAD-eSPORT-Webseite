import fs from "fs";
import path from "path";
import { COUNT_UP_MS, COUNT_UP_STAGGER_MS, countDelay, countFrame, countShape, countStart, countsUp, groupThousands } from "./countUp";

// Hochzählen (#1950, #1974, #1969): eine Rechnung für die ganze App - dieselbe wie im Web (frontend/src/lib/countUp.js).

test("Hochzählen: Form der Zeit, Start bei null, am Ende genau der Text - Wörter zählen nicht", () => {
  const shape = countShape("31:55,056");
  expect(shape?.total).toBe(1915056);
  expect(countFrame(shape, 0)).toBe("00:00,000");
  expect(countFrame(shape, 1)).toBe("31:55,056");
  expect(countFrame(countShape("+6,197"), 0)).toBe("+0,000");
  expect(countFrame(countShape("1:32:15,123"), 0.5)).toMatch(/^\d:\d{2}:\d{2},\d{3}$/);
  for (const text of ["+2 Runden", "Ausfall", "DNF", "–", "", "0", "+0,000", "1:2", "12 s", "1,2,3"]) expect(countShape(text)).toBeNull();
});

test("Endwert exakt: jeder Wert steht am Ende genau so da, wie er kam", () => {
  for (const text of ["1:24,587", "+0,412", "35", "1:32:15,123", "95,5", "0:59.999"]) {
    expect(countFrame(countShape(text), 1)).toBe(text);
    expect(countFrame(countShape(text), 0.999)).not.toBe("");
  }
  expect(countFrame(countShape(1234, true), 1)).toBe("1.234");
  expect(countFrame(countShape(42), 1)).toBe("42");
});

test("Zahlen als Wert: ganze Schritte, Tausenderpunkt auf Wunsch, Null zählt nicht", () => {
  const shape = countShape(12500, true);
  expect(shape?.text).toBe("12.500");
  expect(countFrame(shape, 0)).toBe("0");
  expect(countFrame(shape, 0.5)).toMatch(/^\d{1,2}\.\d{3}$/);
  expect(countShape(0)).toBeNull();
  expect(countShape(Number.NaN)).toBeNull();
  expect(groupThousands(1234567)).toBe("1.234.567");
  expect(groupThousands(999)).toBe("999");
  expect(groupThousands(-1200)).toBe("-1.200");
});

test("vom alten Wert aus: Text in der Form des neuen Werts, Zahl direkt", () => {
  const shape = countShape("1:24,587");
  expect(countStart(shape, "1:25,0")).toBe(85000);
  expect(countFrame(shape, 0, countStart(shape, "1:25,0"))).toBe("1:25,000");
  expect(countStart(countShape(40), 35)).toBe(35);
  expect(countStart(shape, "DNF")).toBe(0);
  expect(countStart(shape, undefined)).toBe(0);
});

test("nur die ersten 24 Zeilen zählen hoch - große Felder starten keine 60 Animationen", () => {
  expect(countsUp(0)).toBe(true);
  expect(countsUp(23)).toBe(true);
  expect(countsUp(24)).toBe(false);
  expect(countsUp(59)).toBe(false);
  expect(countsUp(-1)).toBe(false);
  expect(countDelay(2)).toBe(50);
  expect(countDelay(99)).toBe(24 * COUNT_UP_STAGGER_MS);
});

test("Dauer und Versatz wie im Web (MICRO.count, MICRO.countStagger)", () => {
  const web = fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/motion.js"), "utf8");
  expect(web).toContain(`count: ${COUNT_UP_MS}, countStagger: ${COUNT_UP_STAGGER_MS},`);
});
