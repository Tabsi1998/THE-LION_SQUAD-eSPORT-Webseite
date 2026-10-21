import { formatLapTime, parseLapTime, plausibilityText, plausibilityWarning, showLapTime } from "./laptime";
import cases from "./laptime.cases.json";

// Ein Zeit-Parser (#1584): dieselben Fälle wie App (mobile/src/lib/laptime.test.ts) und Server
// (backend/tests/test_fastlap_laptime_unit.py) - alle lesen laptime.cases.json.

test.each(cases.parse)("parseLapTime($input) = $ms", ({ input, ms }) => {
  expect(parseLapTime(input)).toBe(ms);
});

test.each(cases.empty)("leer ist keine Zeit: %j", (text) => {
  expect(parseLapTime(text)).toBeNull();
});

test.each(cases.invalid)("Unsinn ist NaN: %s", (text) => {
  expect(Number.isNaN(parseLapTime(text))).toBe(true);
});

test("parseLapTime: null und undefined sind keine Zeit", () => {
  expect(parseLapTime(null)).toBeNull();
  expect(parseLapTime(undefined)).toBeNull();
});

test.each(cases.format)("formatLapTime($ms) = $text und zurück", ({ ms, text }) => {
  expect(formatLapTime(ms)).toBe(text);
  expect(parseLapTime(text)).toBe(ms);
});

test("formatLapTime: leer ohne Wert", () => {
  expect(formatLapTime(null)).toBe("");
  expect(formatLapTime(undefined)).toBe("");
});

test.each(cases.plausibility)("plausibilityWarning($ms) = $warning", ({ ms, track, warning }) => {
  expect(plausibilityWarning(ms, track)).toBe(warning);
});

test("plausibilityText nennt Zeit und Grenzen - in der Anzeige mit Komma (#1969)", () => {
  expect(plausibilityText(15000, {})).toBe("0:15,000 ist schneller als die erwartete Untergrenze 0:20,000. Trotzdem speichern?");
  expect(plausibilityText(700000, { max_plausible_ms: 650000 })).toBe("11:40,000 ist langsamer als die erwartete Obergrenze 10:50,000. Trotzdem speichern?");
  expect(plausibilityText(80000, {})).toBe("");
});

test("showLapTime (#1969): angezeigt wird mit Komma wie bei den Rennserien, gespeichert bleibt der Punkt", () => {
  expect(showLapTime(84587)).toBe("1:24,587");
  expect(showLapTime(null)).toBe("");
  // Die Speicher-Form (formatLapTime, gleiche Fälle wie App und Server) bleibt mit Punkt.
  expect(formatLapTime(84587)).toBe("1:24.587");
  // Texte vom Server (time_str, gap_str) werden nur für die Anzeige umgestellt.
  expect(showLapTime("1:24.587")).toBe("1:24,587");
  expect(showLapTime("+0.412")).toBe("+0,412");
  expect(showLapTime("DNF")).toBe("DNF");
});
