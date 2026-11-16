import { STAFFEL_BEFORE_START, staffelBadgePhase, staffelStand, type LeagueSeasonStand, type StaffelLike } from "./staffelStand";

// Liga-Stand statt „Entwurf“ (Folge #2453) - dieselben Fälle wie im Web (frontend/src/lib/seasonTabs.test.js, „Liga-Stand einer
// Staffel“), hier mit `league_season` vom Server wie in GET /api/tournaments/{id} mit Liga-Recht.

const SEASON: LeagueSeasonStand = {
  id: "s1", status: "draft", visibility: "off", start_date: "2026-11-09T23:00:00+00:00",
  application_opens_at: "2026-10-31T23:00:00+00:00", application_closes_at: "2026-11-06T22:59:00+00:00",
};
const OPEN: LeagueSeasonStand = { ...SEASON, visibility: "public" };
const STAFFEL: StaffelLike = { status: "draft", participant_count: 1, league_context: { season_id: "s1" } };
const stand = (staffel: Partial<StaffelLike>, now: string, season: LeagueSeasonStand = OPEN) =>
  staffelStand({ ...STAFFEL, ...staffel, league_season: season }, { now: new Date(now) });

describe("Liga-Stand einer Staffel", () => {
  test("eine Staffel im Entwurf zeigt den Stand der Season, je Phase wie die Ablaufleiste", () => {
    expect(stand({}, "2026-10-20T10:00:00Z")).toMatchObject({ key: "vorbereitung", label: "Vorbereitung" });
    expect(stand({}, "2026-11-02T10:00:00Z")).toMatchObject({ key: "anmeldung", label: "Anmeldung offen bis 06.11., 23:59" });
    expect(stand({}, "2026-11-08T10:00:00Z")).toMatchObject({ key: "einteilung", label: "Einteilung" });
    expect(stand({ status: "live" }, "2026-11-12T10:00:00Z", { ...OPEN, status: "active" })).toMatchObject({ key: "spielbetrieb", label: "Spielbetrieb", live: true });
    expect(stand({ status: "paused" }, "2026-11-12T10:00:00Z", { ...OPEN, status: "active" })).toMatchObject({ label: "Spielbetrieb · pausiert", live: false });
    expect(stand({ status: "completed" }, "2027-02-01T10:00:00Z", { ...SEASON, status: "active" })).toMatchObject({ key: "abschluss", label: "Abgeschlossen" });
    expect(stand({ status: "results_published" }, "2027-02-01T10:00:00Z", { ...SEASON, status: "completed" })).toMatchObject({ key: "abschluss" });
  });

  test("das wirksame Ende der Anmeldung (Nachmeldefrist) gilt vor dem Fensterende", () => {
    const late = { ...OPEN, application_effective_closes_at: "2026-11-03T17:00:00+00:00" };
    expect(stand({}, "2026-11-02T10:00:00Z", late)).toMatchObject({ key: "anmeldung", label: "Anmeldung offen bis 03.11., 18:00" });
    expect(stand({}, "2026-11-04T10:00:00Z", late)).toMatchObject({ key: "einteilung" });
  });

  test("Season läuft, diese Staffel noch nicht gestartet: Einteilung mit fehlendem Start", () => {
    expect(stand({ participant_count: 4 }, "2026-11-12T10:00:00Z", { ...OPEN, status: "active" })).toMatchObject({ key: "einteilung", label: "Einteilung · Start fehlt", live: false });
  });

  test("offen, aber verborgen: „Season verborgen“", () => {
    for (const visibility of ["off", "admins"]) {
      expect(stand({}, "2026-11-02T10:00:00Z", { ...OPEN, visibility })).toMatchObject({ key: "anmeldung", hidden: true, label: "Anmeldung offen bis 06.11., 23:59 · Season verborgen" });
    }
  });

  test("ein gewöhnliches Turnier, eine abgesagte oder archivierte Staffel und eine ohne Season-Angaben haben keinen Liga-Stand", () => {
    expect(staffelStand({ status: "draft", league_season: OPEN })).toBeNull();
    expect(stand({ status: "cancelled" }, "2026-11-02T10:00:00Z")).toBeNull();
    expect(stand({ status: "archived" }, "2026-11-02T10:00:00Z")).toBeNull();
    expect(staffelStand(STAFFEL)).toBeNull();
  });
});

describe("Abzeichen im Kopf der Turnierseite", () => {
  const now = new Date("2026-11-02T10:00:00Z");

  test("mit Liga-Recht: der Liga-Stand, nie „Entwurf“", () => {
    expect(staffelBadgePhase({ ...STAFFEL, league_season: OPEN }, { now })).toEqual({ state: "registration_open", label: "Anmeldung offen bis 06.11., 23:59" });
    expect(staffelBadgePhase({ ...STAFFEL, status: "live", league_season: { ...OPEN, status: "active" } }, { now: new Date("2026-11-12T10:00:00Z") }))
      .toEqual({ state: "live", label: "Spielbetrieb" });
  });

  test("ohne Liga-Recht (keine Season-Angaben) vor dem Start neutral", () => {
    expect(staffelBadgePhase(STAFFEL, { now })).toEqual({ state: "draft", label: STAFFEL_BEFORE_START });
    // Nur über league_links erkannt (ältere Antwort ohne league_context).
    expect(staffelBadgePhase({ status: "draft", league_links: { league_name: "Tiroler Liga" } }, { now })?.label).toBe(STAFFEL_BEFORE_START);
  });

  test("gewöhnliche Turniere und gestartete Staffeln ohne Season-Angaben: die Phase vom Server bleibt", () => {
    expect(staffelBadgePhase({ status: "draft" }, { now })).toBeNull();
    expect(staffelBadgePhase({ ...STAFFEL, status: "live" }, { now })).toBeNull();
    expect(staffelBadgePhase({ ...STAFFEL, status: "cancelled", league_season: OPEN }, { now })).toBeNull();
  });
});
