import { dayOptions, shiftTime, viennaWall, wallToIso, withDay } from "./dateChoice";

// Datum und Uhrzeit zum Antippen (#1139) in Wiener Zeit (#960): „20:00“ heißt 20:00 in Wien - im Sommer 18:00 UTC,
// im Winter 19:00 UTC -, egal in welcher Zeitzone das Handy (oder der Prüfrechner) steht.

test("Wiener Uhr hin und zurück - Sommer und Winter", () => {
  expect(viennaWall("2026-05-19T18:00:00Z")).toBe("2026-05-19T20:00");
  expect(wallToIso("2026-05-19T20:00")).toBe("2026-05-19T18:00:00.000Z");
  expect(viennaWall("2026-12-01T19:00:00Z")).toBe("2026-12-01T20:00");
  expect(wallToIso("2026-12-01T20:00")).toBe("2026-12-01T19:00:00.000Z");
  expect(wallToIso("2026-05-19 20:00")).toBeNull();
});

test("ohne Termin: der nächste Halbstunden-Schritt", () => {
  expect(viennaWall(null, new Date("2026-05-19T17:10:00Z"))).toBe("2026-05-19T19:30");
});

test("Tage zum Antippen ab heute in Wien", () => {
  // 23:30 in Wien ist schon der nächste Tag als in UTC.
  const days = dayOptions(new Date("2026-05-19T22:30:00Z"), 4);
  expect(days.map((option) => option.day)).toEqual(["2026-05-20", "2026-05-21", "2026-05-22", "2026-05-23"]);
  expect(days.map((option) => option.label)).toEqual(["Heute", "Morgen", "Fr 22.5.", "Sa 23.5."]);
});

test("Tag tauschen behält die Uhrzeit; die Uhrzeit springt in Viertelstunden und bleibt im Tag", () => {
  expect(withDay("2026-05-19T20:00", "2026-05-23")).toBe("2026-05-23T20:00");
  expect(shiftTime("2026-05-19T20:00", 15)).toBe("2026-05-19T20:15");
  expect(shiftTime("2026-05-19T20:00", -60)).toBe("2026-05-19T19:00");
  expect(shiftTime("2026-05-19T23:45", 15)).toBe("2026-05-19T23:45");
  expect(shiftTime("2026-05-19T00:00", -15)).toBe("2026-05-19T00:00");
  expect(shiftTime("2026-05-19T20:07", 0)).toBe("2026-05-19T20:00");
});
