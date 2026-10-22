import fs from "fs";
import path from "path";
import { formatLapTime, parseLapTime, plausibilityText, plausibilityWarning, showLapTime } from "./laptime";

// Ein Zeit-Parser (#1584): dieselben Fälle wie Website (frontend/src/lib/laptime.test.js) und Server
// (backend/tests/test_fastlap_laptime_unit.py) - alle lesen frontend/src/lib/laptime.cases.json. „90“ sind 90 Sekunden,
// nicht 90 Millisekunden.
type Cases = {
  parse: Array<{ input: string; ms: number }>;
  empty: string[];
  invalid: string[];
  format: Array<{ ms: number; text: string }>;
  plausibility: Array<{ ms: number; track: Record<string, number | null> | null; warning: string | null }>;
};
const CASES: Cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/laptime.cases.json"), "utf8"));

test.each(CASES.parse)("parseLapTime($input) = $ms", ({ input, ms }) => {
  expect(parseLapTime(input)).toBe(ms);
});

test.each(CASES.empty)("leer ist keine Zeit: %j", (text) => {
  expect(parseLapTime(text)).toBeNull();
});

test.each(CASES.invalid)("Unsinn ist NaN: %s", (text) => {
  expect(Number.isNaN(parseLapTime(text))).toBe(true);
});

test.each(CASES.format)("formatLapTime($ms) = $text und zurück", ({ ms, text }) => {
  expect(formatLapTime(ms)).toBe(text);
  expect(parseLapTime(text)).toBe(ms);
});

test.each(CASES.plausibility)("plausibilityWarning($ms) = $warning", ({ ms, track, warning }) => {
  expect(plausibilityWarning(ms, track)).toBe(warning);
});

test("plausibilityText nennt Zeit und Grenzen - wie die Website, in der Anzeige mit Komma (#1969)", () => {
  expect(plausibilityText(15000, {})).toBe("0:15,000 ist schneller als die erwartete Untergrenze 0:20,000. Trotzdem speichern?");
  expect(plausibilityText(700000, { max_plausible_ms: 650000 })).toBe("11:40,000 ist langsamer als die erwartete Obergrenze 10:50,000. Trotzdem speichern?");
  expect(plausibilityText(80000, {})).toBe("");
});

test("showLapTime (#1969): angezeigt wird mit Komma wie im Web, gespeichert bleibt der Punkt", () => {
  expect(showLapTime(84587)).toBe("1:24,587");
  expect(showLapTime(null)).toBe("");
  expect(showLapTime(undefined)).toBe("");
  expect(showLapTime("")).toBe("");
  expect(showLapTime("1:24.587")).toBe("1:24,587");
  expect(showLapTime("+0.412")).toBe("+0,412");
  expect(showLapTime("DNF")).toBe("DNF");
  // Gespeichert bzw. gesendet wird weiter mit Punkt.
  expect(formatLapTime(84587)).toBe("1:24.587");
});

test.each(CASES.format)("showLapTime($ms) ist die Anzeige von $text mit Komma", ({ ms, text }) => {
  expect(showLapTime(ms)).toBe(text.replace(".", ","));
  expect(parseLapTime(showLapTime(ms))).toBe(ms);
});
