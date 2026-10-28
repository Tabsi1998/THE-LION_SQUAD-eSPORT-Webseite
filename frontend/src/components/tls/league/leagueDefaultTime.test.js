import { defaultTimeText } from "./leagueGames";

// Standardtermin der Spielwoche (#2096): Wochentag, Tag, Monat und Uhrzeit in Wiener Zeit - Winter- wie Sommerzeit.

test("Sonntag 20:00 Wien als kurzer Satz", () => {
  expect(defaultTimeText("2026-11-15T19:00:00+00:00")).toBe("So 15.11., 20:00");
  expect(defaultTimeText("2027-01-10T19:00:00+00:00")).toBe("So 10.1., 20:00");
  expect(defaultTimeText("2026-06-07T18:00:00+00:00")).toBe("So 7.6., 20:00");
});

test("ohne Wert: leer", () => {
  expect(defaultTimeText(null)).toBe("");
  expect(defaultTimeText("")).toBe("");
});
