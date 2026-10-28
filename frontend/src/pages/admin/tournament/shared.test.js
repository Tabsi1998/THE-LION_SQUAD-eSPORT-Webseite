import { primaryTournamentAction } from "./shared";

// Der nächste Schritt oben in der Turnierverwaltung. Eine Liga-Staffel (docs/LIGA.md, #2096) startet ohne Check-in:
// die Co-Teams sind zugeteilt, „Live“ macht den Spielplan fest.

const STAFFEL = { league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" } };

describe("primaryTournamentAction", () => {
  it.each(["draft", "scheduled", "registration_open", "registration_closed"])("ein Turnier im Stand %s startet den Check-in", (status) => {
    expect(primaryTournamentAction(status)).toEqual({ status: "check_in", label: "Check-in starten" });
    expect(primaryTournamentAction(status, { format: "league" })).toEqual({ status: "check_in", label: "Check-in starten" });
  });

  it.each(["draft", "registration_closed"])("eine Liga-Staffel im Stand %s startet direkt", (status) => {
    expect(primaryTournamentAction(status, STAFFEL)).toEqual({ status: "live", label: "Liga starten" });
  });

  it("danach wie bisher: Check-in → starten, Pause → fortsetzen, live → nichts", () => {
    expect(primaryTournamentAction("check_in", STAFFEL)).toEqual({ status: "live", label: "Turnier starten" });
    expect(primaryTournamentAction("paused", STAFFEL)).toEqual({ status: "live", label: "Fortsetzen" });
    expect(primaryTournamentAction("live", STAFFEL)).toBeNull();
  });
});
