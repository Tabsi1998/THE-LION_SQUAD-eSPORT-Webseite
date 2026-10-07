import { eventIsOver, matchIsOver, tournamentIsOver } from "@/lib/afterEnd";

// Regel „vorbei“ (#1221): Event nach seinem letzten Tag in Wiener Zeit, Turnier mit Ende oder veröffentlichten
// Ergebnissen, Match beendet, gewertet oder Freilos. Feste Zeitpunkte - kein Test hängt an der Uhr des Rechners.

const at = (iso) => new Date(iso);

test("Event: vorbei erst am Tag nach dem letzten Tag - in Wiener Zeit", () => {
  const event = { status: "scheduled", start_date: "2026-06-20T08:00:00Z", end_date: "2026-06-21T18:00:00Z" };
  expect(eventIsOver(event, at("2026-06-20T12:00:00Z"))).toBe(false);
  // Am letzten Tag nach dem Ende (20:00 in Wien) ist es noch nicht „vorbei“ - erst ab Mitternacht in Wien.
  expect(eventIsOver(event, at("2026-06-21T21:30:00Z"))).toBe(false); // 23:30 in Wien
  expect(eventIsOver(event, at("2026-06-21T22:30:00Z"))).toBe(true); // 00:30 am 22.6. in Wien
});

test("Event: ein Ende nach Mitternacht zählt zum nächsten Tag; ohne Ende gilt der Beginn", () => {
  const night = { status: "scheduled", start_date: "2026-06-20T16:00:00Z", end_date: "2026-06-21T00:30:00Z" }; // 02:30 am 21.6. in Wien
  expect(eventIsOver(night, at("2026-06-21T12:00:00Z"))).toBe(false);
  expect(eventIsOver(night, at("2026-06-21T22:30:00Z"))).toBe(true);
  expect(eventIsOver({ status: "scheduled", start_date: "2026-06-20T08:00:00Z" }, at("2026-06-20T20:00:00Z"))).toBe(false);
  expect(eventIsOver({ status: "scheduled", start_date: "2026-06-20T08:00:00Z" }, at("2026-06-21T08:00:00Z"))).toBe(true);
  expect(eventIsOver({ status: "scheduled" }, at("2026-06-21T08:00:00Z"))).toBe(false);
  expect(eventIsOver(null)).toBe(false);
});

test("Event: mehrtägig zählt der letzte Programmtag; beendet, archiviert und abgesagt sind sofort vorbei", () => {
  const multi = { status: "live", schedule: { days: [{ end_at: "2026-10-16T21:00:00Z" }, { end_at: "2026-10-18T14:00:00Z" }] }, start_date: "2026-10-16T16:00:00Z" };
  expect(eventIsOver(multi, at("2026-10-18T20:00:00Z"))).toBe(false);
  expect(eventIsOver(multi, at("2026-10-19T08:00:00Z"))).toBe(true);
  for (const status of ["completed", "archived", "cancelled"]) {
    expect(eventIsOver({ status, start_date: "2030-01-01T10:00:00Z" }, at("2026-06-01T10:00:00Z"))).toBe(true);
  }
});

test("Turnier: beendet oder Ergebnisse veröffentlicht", () => {
  expect(tournamentIsOver({ status: "live" })).toBe(false);
  expect(tournamentIsOver({ status: "registration_open", public_phase: { state: "registration_open" } })).toBe(false);
  expect(tournamentIsOver({ status: "completed" })).toBe(true);
  expect(tournamentIsOver({ status: "results_published" })).toBe(true);
  expect(tournamentIsOver({ status: "live", public_phase: { state: "completed" } })).toBe(true);
  expect(tournamentIsOver(null)).toBe(false);
});

test("Match: beendet, gewertet, Freilos oder abgesagt", () => {
  for (const status of ["completed", "forfeit", "bye", "archived", "cancelled"]) expect(matchIsOver({ status })).toBe(true);
  for (const status of ["scheduled", "ready", "in_progress", "waiting_result", "disputed"]) expect(matchIsOver({ status })).toBe(false);
});
