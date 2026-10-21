import { formatRaceTime, isNoRaceTime } from "./raceTime";

// Rennzeiten in der App (#1981, #1974): angezeigt wie beim Veranstalter und wie im Web (frontend/src/lib/raceTime.js)
// mit Komma vor den Nachkommastellen. Gespeichert bleibt am Server der Punkt - die App liest nur.

test("Anzeige mit Komma - egal ob der Server Punkt oder Komma schickt", () => {
  expect(formatRaceTime("1:20.361")).toBe("1:20,361");
  expect(formatRaceTime("1:20,361")).toBe("1:20,361");
  expect(formatRaceTime("31:55.056")).toBe("31:55,056");
  expect(formatRaceTime("1:32:15.123")).toBe("1:32:15,123");
  expect(formatRaceTime("+0.046")).toBe("+0,046");
  expect(formatRaceTime("+1:34.878")).toBe("+1:34,878");
  expect(formatRaceTime(" 1:20.361 ")).toBe("1:20,361");
});

test("Platzhalter heißt keine Zeit; Runden, DNF und anderer Text bleiben, wie sie sind", () => {
  for (const placeholder of ["+--:--,---", "--:--.---", "--:--:--,---"]) {
    expect(isNoRaceTime(placeholder)).toBe(true);
    expect(formatRaceTime(placeholder)).toBe("");
  }
  expect(formatRaceTime("+1 Runde")).toBe("+1 Runde");
  expect(formatRaceTime("DNF")).toBe("DNF");
  expect(formatRaceTime("")).toBe("");
  expect(formatRaceTime(null)).toBe("");
  expect(formatRaceTime(undefined)).toBe("");
  expect(isNoRaceTime("1:20.361")).toBe(false);
});
