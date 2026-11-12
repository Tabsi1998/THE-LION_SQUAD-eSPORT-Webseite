import { deadlineText, leagueSeatsLine, leagueSortTime, nextDeadline, openSignups, periodLine } from "./leagueHome";

// Liga auf der Startseite (#2324): offene Fenster, Zeitraum, freie Plätze und Sortierung.
const NOW = Date.parse("2026-11-09T12:00:00Z");
const open = (id, closes) => ({ id, application: { state: "open", closes_at: closes, slots: 16, slots_free: 3 } });

test("nur offene Fenster mit Anmeldeschluss in der Zukunft werben, der nächste Schluss zuerst", () => {
  const rows = [open("a", "2026-11-21T22:59:00Z"), open("b", "2026-11-09T11:00:00Z"), open("c", "2026-11-12T10:00:00Z"),
    { id: "d", application: { state: "upcoming", closes_at: "2026-12-01T00:00:00Z" } }, { id: "e", application: null }];
  expect(openSignups(rows, NOW).map((row) => row.id)).toEqual(["a", "c"]);
  expect(nextDeadline(rows, NOW)).toBe(Date.parse("2026-11-12T10:00:00Z"));
  expect(nextDeadline([], NOW)).toBeNull();
  expect(openSignups(null, NOW)).toEqual([]);
});

test("Zeitraum und Anmeldeschluss in Wiener Zeit", () => {
  expect(periodLine({ start_date: "2026-11-15T23:00:00Z", end_date: "2027-01-24T22:59:59Z" })).toBe("16.11.2026 – 24.01.2027");
  expect(periodLine({ start_date: "2026-11-15T23:00:00Z" })).toBe("16.11.2026");
  expect(deadlineText("2026-11-21T22:59:00Z")).toMatch(/21\.11\.2026, 23:59 Uhr$/);
  expect(deadlineText(null)).toBe("");
});

test("freie Plätze nur vor und während der Anmeldung, Sortierung nach dem nächsten Datum", () => {
  expect(leagueSeatsLine(open("a", "2026-11-21T22:59:00Z"))).toBe("3 von 16 Startplätzen frei");
  expect(leagueSeatsLine({ application: { state: "closed", slots: 16, slots_free: 3 } })).toBe("");
  expect(leagueSeatsLine({ application: null })).toBe("");
  expect(leagueSortTime({ sort_at: "2026-11-21T22:59:00Z" })).toBe(Date.parse("2026-11-21T22:59:00Z"));
  expect(leagueSortTime({})).toBe(Number.MAX_SAFE_INTEGER);
});
