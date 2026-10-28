import {
  bracketFixed, fixedRegistrationIds, guardDetail, impactText, matchImpact, primaryTournamentAction, statusChangeNotice,
  swissUndoInfo,
} from "./shared";

// Folgenschwere Aktionen (#2120): dieselben Regeln wie der Server (services/tournament_guard.py).
const preview = { id: "p1", is_preview: true, status: "pending", slots: [{ registration_id: "r9" }] };
const open = { id: "m1", status: "ready", round: 1, slots: [{ registration_id: "r1" }, { registration_id: "r2" }] };
const done = { id: "m2", status: "completed", round: 1, results: [{ registration_id: "r3", rank: 1 }], slots: [{ registration_id: "r3" }] };
const bye = { id: "m3", status: "completed", round: 1, result_meta: { source: "swiss_bye" }, results: [{ registration_id: "r4" }], slots: [{ registration_id: "r4" }] };
const called = { id: "m4", status: "ready", round: 2, called_at: "2026-10-28T10:00:00Z", slots: [] };

describe("Absichern (#2120)", () => {
  it("zählt echte Spiele und wie viele davon begonnen oder gewertet sind", () => {
    expect(matchImpact([preview, open, done, called])).toEqual({ match_count: 3, played_count: 2 });
    expect(impactText({ match_count: 3, played_count: 2 })).toBe("3 Spiele, davon 2 begonnen oder gewertet");
    expect(impactText({ match_count: 1, played_count: 0 })).toBe("1 Spiel, keines davon begonnen");
  });

  it("der Baum steht ab dem Check-in-Ende, nach dem Start oder mit echten Spielen", () => {
    expect(bracketFixed({ status: "registration_open" }, [preview])).toBe(false);
    expect(bracketFixed({ status: "check_in", check_in_closed_at: "2026-10-28T10:00:00Z" }, [])).toBe(true);
    expect(bracketFixed({ status: "live" }, [])).toBe(true);
    expect(bracketFixed({ status: "registration_open" }, [open])).toBe(true);
  });

  it("nur Anmeldungen in echten Spielen gelten als fest", () => {
    expect([...fixedRegistrationIds([preview, open])].sort()).toEqual(["r1", "r2"]);
  });

  it("die letzte Schweizer Runde geht zurück, solange keines ihrer Spiele begonnen hat - ein Freilos zählt nicht", () => {
    expect(swissUndoInfo([open, bye])).toEqual({ round: 1, count: 2 });
    expect(swissUndoInfo([open, done])).toBeNull();
    expect(swissUndoInfo([open, called])).toBeNull();
    expect(swissUndoInfo([preview])).toBeNull();
  });

  it("liest nur die passende Rückfrage des Servers", () => {
    const error = { response: { status: 409, data: { detail: { code: "confirm_destruction", message: "x" } } } };
    expect(guardDetail(error, "confirm_destruction")).toMatchObject({ message: "x" });
    expect(guardDetail(error, "bracket_fixed")).toBeNull();
    expect(guardDetail({ response: { status: 409, data: { detail: "Text" } } }, "confirm_destruction")).toBeNull();
  });

  it("fragt vor Status mit Folgen nach - Absage mit freiwilligem Grund", () => {
    const t = { status: "registration_open" };
    expect(statusChangeNotice("registration_closed", t)).toBeNull();
    expect(statusChangeNotice("registration_open", t)).toBeNull();
    expect(statusChangeNotice("draft", t).description).toMatch(/öffentliche Seite/);
    expect(statusChangeNotice("results_published", { status: "completed" }).description).toMatch(/Jahreswertung/);
    expect(statusChangeNotice("completed", { status: "live" }).title).toBe("Turnier beenden?");
    expect(statusChangeNotice("completed", { status: "results_published" })).toBeNull();
    const cancel = statusChangeNotice("cancelled", t, { activeRegistrations: 5 });
    expect(cancel.askReason).toBe(true);
    expect(cancel.description).toMatch(/Alle 5 Anmeldungen bekommen eine Nachricht/);
  });
});

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
