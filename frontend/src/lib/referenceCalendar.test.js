import { addDays, dayLabel, moveIds, roundLabel, roundPayload, roundToForm, roundWhen, suggestNextDay, weekdayOf } from "./referenceCalendar";

// Kalender externer Serien (#1742): nur Beschriftung und Vorschläge in Kalendertagen - der Status kommt vom Server.

test("Kalendertage zählen ohne Uhr des Geräts, Wochentag 0 = Montag", () => {
  expect(addDays("2026-10-24", 2)).toBe("2026-10-26"); // über die Zeitumstellung
  expect(addDays("2026-12-31", 1)).toBe("2027-01-01");
  expect(weekdayOf("2026-11-05")).toBe(3);
  expect(weekdayOf("2026-11-09")).toBe(0);
});

test("der nächste Termin folgt dem Standard-Wochentag nach dem letzten Termin", () => {
  const rounds = [{ club_day: "2026-11-05" }, { club_day: null }, { club_day: "2026-10-29" }];
  expect(suggestNextDay(rounds, 3, "2026-10-19")).toBe("2026-11-12");
  expect(suggestNextDay(rounds, 1, "2026-10-19")).toBe("2026-11-10");
  expect(suggestNextDay(rounds, null, "2026-10-19")).toBe("2026-11-12");
  expect(suggestNextDay([], 3, "2026-10-19")).toBe("2026-10-22");
  expect(suggestNextDay([], 0, "2026-10-19")).toBe("2026-10-19");
  expect(suggestNextDay([], "", "2026-10-19")).toBe("2026-10-19");
  expect(suggestNextDay([], 3, undefined)).toBe("");
});

test("Beschriftung: Tag, Uhrzeit, offener Termin, Kürzel", () => {
  expect(dayLabel("2026-11-05")).toBe("Do., 05.11.2026");
  expect(roundWhen({ club_day: "2026-11-05", time: "20:30" })).toBe("Do., 05.11.2026 · 20:30");
  expect(roundWhen({ club_day: "2026-11-05", time: null })).toBe("Do., 05.11.2026");
  expect(roundWhen({ club_day: null })).toBe("Termin offen");
  expect(roundLabel({ code: "R3", position: 3 })).toBe("R3");
  expect(roundLabel({ code: "", position: 4 })).toBe("Termin 4");
});

test("Reihenfolge tauschen, am Rand nichts", () => {
  const rounds = [{ id: "a" }, { id: "b" }, { id: "c" }];
  expect(moveIds(rounds, 1, -1)).toEqual(["b", "a", "c"]);
  expect(moveIds(rounds, 1, 1)).toEqual(["a", "c", "b"]);
  expect(moveIds(rounds, 0, -1)).toBeNull();
  expect(moveIds(rounds, 2, 1)).toBeNull();
});

test("Formular und Body: neuer Termin mit Vorschlag, leere Uhrzeit heißt ohne Uhrzeit", () => {
  const fresh = roundToForm({}, { day: "2026-11-12", time: "20:30" });
  expect(fresh).toMatchObject({ day: "2026-11-12", time: "20:30", kind: "regular", counts: true });
  const existing = roundToForm({ id: "r1", code: "R1", club_day: "2026-11-05", time: null, counts: false }, { day: "2026-11-12", time: "20:30" });
  expect(existing).toMatchObject({ code: "R1", day: "2026-11-05", time: "", counts: false });
  expect(roundPayload({ ...existing, venue: "  Probering ", note: " " })).toEqual({
    code: "R1", title: null, venue: "Probering", day: "2026-11-05", time: null, kind: "regular", counts: false, opponent: null, note: null,
  });
});
