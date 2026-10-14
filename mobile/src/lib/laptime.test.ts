import fs from "fs";
import path from "path";
import { formatLapTime, parseLapTime, plausibilityText, plausibilityWarning } from "./laptime";

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

test("plausibilityText nennt Zeit und Grenzen - wie die Website", () => {
  expect(plausibilityText(15000, {})).toBe("0:15.000 ist schneller als die erwartete Untergrenze 0:20.000. Trotzdem speichern?");
  expect(plausibilityText(80000, {})).toBe("");
});
