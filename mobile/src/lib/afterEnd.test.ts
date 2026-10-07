import { challengeIsOver, eventIsOver, tournamentIsOver } from "./afterEnd";

// Regel „vorbei“ (#1221) - dieselbe wie im Web: Event nach seinem letzten Tag in Wiener Zeit, Turnier mit Ende oder
// veröffentlichten Ergebnissen, Fast Lap beendet oder nach ihrem letzten Tag. Feste Zeitpunkte statt der Uhr.

const at = (iso: string) => new Date(iso);

describe("Regel vorbei", () => {
  it("Event: erst am Tag nach dem letzten Tag - in Wiener Zeit", () => {
    const event = { status: "scheduled", start_date: "2026-06-20T08:00:00Z", end_date: "2026-06-21T18:00:00Z" };
    expect(eventIsOver(event, at("2026-06-21T21:30:00Z"))).toBe(false);
    expect(eventIsOver(event, at("2026-06-21T22:30:00Z"))).toBe(true);
    expect(eventIsOver({ status: "cancelled", start_date: "2030-01-01T10:00:00Z" }, at("2026-06-01T10:00:00Z"))).toBe(true);
    expect(eventIsOver({ status: "scheduled", date: "2026-06-20T08:00:00Z" }, at("2026-06-21T08:00:00Z"))).toBe(true);
    expect(eventIsOver(null)).toBe(false);
  });

  it("Turnier: beendet oder Ergebnisse veröffentlicht", () => {
    expect(tournamentIsOver({ status: "live" })).toBe(false);
    expect(tournamentIsOver({ status: "results_published" })).toBe(true);
    expect(tournamentIsOver({ status: "live", public_phase: { state: "completed" } })).toBe(true);
  });

  it("Fast Lap: beendet oder nach dem letzten Tag; ohne Ende läuft sie weiter", () => {
    expect(challengeIsOver({ status: "active", end_date: "2026-06-21T18:00:00Z" }, at("2026-06-21T20:00:00Z"))).toBe(false);
    expect(challengeIsOver({ status: "active", end_date: "2026-06-21T18:00:00Z" }, at("2026-06-22T08:00:00Z"))).toBe(true);
    expect(challengeIsOver({ status: "active", start_date: "2026-01-01T10:00:00Z" }, at("2026-06-22T08:00:00Z"))).toBe(false);
    expect(challengeIsOver({ status: "completed" }, at("2026-06-22T08:00:00Z"))).toBe(true);
  });
});
