import { addDays, dayLabel, moveIds, opponentText, roundLabel, roundPayload, roundToForm, roundWhen, sideLabel, suggestNextDay, weekdayOf } from "./referenceCalendar";

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

test("Team-Liga (#1931): Heim/Auswärts und Ende des Spieltags im Formular, Gegner und Zeitraum in Worten", () => {
  const form = roundToForm({ id: "r1", club_day: "2026-05-13", club_day_end: "2026-05-17", at_home: false, opponent: "Probe Wölfe" });
  expect(form).toMatchObject({ day: "2026-05-13", day_end: "2026-05-17", at_home: "away", opponent: "Probe Wölfe" });
  expect(roundPayload(form, { teamLeague: true })).toMatchObject({ at_home: false, day_end: "2026-05-17", opponent: "Probe Wölfe" });
  expect(roundPayload({ ...form, at_home: "", day_end: "" }, { teamLeague: true })).toMatchObject({ at_home: null, day_end: null });
  expect(roundPayload(form)).not.toHaveProperty("at_home");
  expect(roundToForm({ id: "r2", at_home: true }).at_home).toBe("home");

  expect(roundWhen({ club_day: "2026-05-13", club_day_end: "2026-05-17", time: "20:00" })).toBe("Mi., 13.05. – So., 17.05.2026");
  expect(roundWhen({ club_day: "2026-12-29", club_day_end: "2027-01-02" })).toBe("Di., 29.12.2026 – Sa., 02.01.2027");
  expect(opponentText({ opponent: "Probe Falken", at_home: true })).toBe("vs Probe Falken");
  expect(opponentText({ opponent: "Probe Falken", at_home: false })).toBe("@ Probe Falken");
  expect(opponentText({ opponent: "Probe Falken" })).toBe("gegen Probe Falken");
  expect(opponentText({ opponent: "" })).toBe("");
  expect(sideLabel({ at_home: true })).toBe("Heim");
  expect(sideLabel({ at_home: false })).toBe("Auswärts");
  expect(sideLabel({})).toBe("");
});

test("Formular und Body: neuer Termin mit Vorschlag, leere Uhrzeit heißt ohne Uhrzeit", () => {
  const fresh = roundToForm({}, { day: "2026-11-12", time: "20:30" });
  expect(fresh).toMatchObject({ day: "2026-11-12", time: "20:30", kind: "regular", counts: true });
  const existing = roundToForm({ id: "r1", code: "R1", club_day: "2026-11-05", time: null, counts: false }, { day: "2026-11-12", time: "20:30" });
  expect(existing).toMatchObject({ code: "R1", day: "2026-11-05", time: "", counts: false });
  expect(roundPayload({ ...existing, venue: "  Probering ", note: " " })).toEqual({
    code: "R1", session: null, title: null, venue: "Probering", day: "2026-11-05", time: null, kind: "regular", counts: false, opponent: null, note: null,
    country_auto: true,
  });
  // Lauf (#1930): getrimmt, leer heißt Rennen.
  expect(roundPayload({ ...existing, session: " Sprint " }).session).toBe("Sprint");
  expect(roundToForm({ id: "r2", session: "Qualifying" }).session).toBe("Qualifying");
});
