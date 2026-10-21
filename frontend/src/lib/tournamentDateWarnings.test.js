import { dateWarnings } from "./tournamentDateWarnings";

// Widersprüchliche Zeiten im Turnier-Formular (#1938): Anlegen und Bearbeiten warnen gleich.

test("Ende vor Beginn: Turnier, Anmeldung und Check-in", () => {
  expect(dateWarnings({ check_in_from: "2026-10-31T16:50", check_in_until: "2026-10-31T16:30" })).toEqual(["Der Check-in endet vor seiner Öffnung."]);
  expect(dateWarnings({ start_date: "2026-10-31T17:00", end_date: "2026-10-31T16:00" })).toEqual(["Das Ende liegt vor dem Start."]);
  expect(dateWarnings({ registration_open_from: "2026-10-20T10:00", registration_open_until: "2026-10-19T10:00" })).toEqual(["Die Anmeldung endet vor ihrer Öffnung."]);
});

test("Anmeldung oder Check-in enden nach dem Start", () => {
  expect(dateWarnings({ start_date: "2026-10-31T17:00", registration_open_until: "2026-10-31T17:30", check_in_until: "2026-10-31T17:10" })).toEqual([
    "Die Anmeldung endet nach dem Turnierstart.",
    "Der Check-in endet nach dem Turnierstart.",
  ]);
});

test("stimmige oder leere Zeiten: keine Warnung", () => {
  expect(dateWarnings({ start_date: "2026-10-31T17:00", end_date: "2026-10-31T22:00", check_in_from: "2026-10-31T16:00", check_in_until: "2026-10-31T16:45" })).toEqual([]);
  expect(dateWarnings({ check_in_from: "", check_in_until: "kaputt" })).toEqual([]);
  expect(dateWarnings({})).toEqual([]);
});
