import { formatRaceTime, isNoRaceTime, normalizeRaceTime } from "@/lib/raceTime";

// Rennzeiten (#1981): angezeigt mit Komma wie beim Veranstalter, gespeichert mit Punkt wie bisher.

test("Anzeige mit Komma - egal ob mit Punkt oder Komma eingegeben", () => {
  expect(formatRaceTime("1:20.361")).toBe("1:20,361");
  expect(formatRaceTime("1:20,361")).toBe("1:20,361");
  expect(formatRaceTime("31:55.056")).toBe("31:55,056");
  expect(formatRaceTime("1:32:15.123")).toBe("1:32:15,123");
  expect(formatRaceTime("+0.046")).toBe("+0,046");
  expect(formatRaceTime("+1:34.878")).toBe("+1:34,878");
  expect(formatRaceTime(" 1:20.361 ")).toBe("1:20,361");
});

test("Speichern mit Punkt - wie bisher", () => {
  expect(normalizeRaceTime("1:20,361")).toBe("1:20.361");
  expect(normalizeRaceTime("1:20.361")).toBe("1:20.361");
  expect(normalizeRaceTime("+0,046")).toBe("+0.046");
  expect(normalizeRaceTime("+1:34,878")).toBe("+1:34.878");
});

test("Platzhalter bei P1 heißt keine Zeit; Runden, DNF und anderer Text bleiben", () => {
  for (const placeholder of ["+--:--,---", "--:--.---", "--:--:--,---"]) {
    expect(isNoRaceTime(placeholder)).toBe(true);
    expect(formatRaceTime(placeholder)).toBe("");
    expect(normalizeRaceTime(placeholder)).toBe("");
  }
  expect(formatRaceTime("+1 Runde")).toBe("+1 Runde");
  expect(normalizeRaceTime("+2 Runden")).toBe("+2 Runden");
  expect(formatRaceTime("DNF")).toBe("DNF");
  expect(formatRaceTime("")).toBe("");
  expect(formatRaceTime(null)).toBe("");
  expect(isNoRaceTime("1:20.361")).toBe(false);
});
