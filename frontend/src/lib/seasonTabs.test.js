import { describe, expect, it } from "vitest";
import { seasonPayload, seasonToForm } from "./league";
import {
  SEASON_TABS, TAB_FIELDS, TAB_PAYLOAD_KEYS, changedPlaces, dirtyTabs, nicknameRepeatsLevel, orderPoolHints, readinessAnchor, rebaseForm, rulesNotice,
  STAFFEL_STAND_FILTERS, seasonAnchorUrl, seasonPhases, seasonTarget, applicationEnd, staffelNeeds, staffelStand, statusFilterKeys, tabPayload,
} from "./seasonTabs";

// Season-Seite mit Reitern (#2267): Adresse ↔ Reiter, Felder je Reiter, Speichern je Reiter, Ablaufleiste, Hinweise.

const SEASON = {
  id: "s1", name: "Season 1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7, default_match_weekday: 6,
  default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4, game_mode_order: [],
  scoring_rules: { match_points: { win: 3, draw: 0, loss: 0 }, table_tiebreakers: ["score_diff"] }, result_confirm_hours: 48, lineup_amend_hours: 48,
  rules_text: "", visibility: "off", status: "draft", blocked_periods: [], lineup_mode: "series", entry_policy: "all",
  application_opens_at: "2026-10-31T23:00:00+00:00", application_closes_at: "2026-11-06T22:59:00+00:00",
};

describe("Reiter und Adresse", () => {
  it("ohne oder mit unbekannter Sprungmarke der Überblick, sonst der Reiter", () => {
    expect(seasonTarget("")).toEqual({ tab: "ueberblick", section: "" });
    expect(seasonTarget("#gibtsnicht")).toEqual({ tab: "ueberblick", section: "" });
    expect(seasonTarget("#termine")).toEqual({ tab: "termine", section: "" });
    expect(seasonTarget("#TABELLE")).toEqual({ tab: "tabelle", section: "" });
  });

  it("Abschnitte führen in ihren Reiter - auch die alte Marke #anmeldungen aus den Nachrichten des Servers", () => {
    expect(seasonTarget("#anmeldungen")).toEqual({ tab: "anmeldung", section: "anmeldungen" });
    expect(seasonTarget("#kader")).toEqual({ tab: "anmeldung", section: "kader" });
    expect(seasonTarget("#modi")).toEqual({ tab: "spielbetrieb", section: "modi" });
    expect(seasonTarget("#sperrliste")).toEqual({ tab: "regelwerk", section: "sperrliste" });
    expect(seasonTarget("#uebertragen")).toEqual({ tab: "ligen", section: "uebertragen" });
  });

  it("baut Adressen mit Reiter oder Abschnitt, der Überblick ohne Marke", () => {
    expect(seasonAnchorUrl("s1")).toBe("/admin/leagues/seasons/s1");
    expect(seasonAnchorUrl("s1", "ueberblick")).toBe("/admin/leagues/seasons/s1");
    expect(seasonAnchorUrl("s1", "regelwerk")).toBe("/admin/leagues/seasons/s1#regelwerk");
    expect(seasonAnchorUrl("s1", "anmeldungen")).toBe("/admin/leagues/seasons/s1#anmeldungen");
  });

  it("jeder Punkt der Prüfung springt an seine Stelle", () => {
    expect(readinessAnchor("pool_missing")).toBe("modi");
    expect(readinessAnchor("pool_too_small")).toBe("modi");
    expect(readinessAnchor("inactive_map")).toBe("modi");
    expect(readinessAnchor("mode_order_missing")).toBe("serie");
    expect(readinessAnchor("rules_missing")).toBe("regelwerk");
    expect(readinessAnchor("application_after_start")).toBe("selbstanmeldung");
    expect(readinessAnchor("staffel_missing")).toBe("staffeln");
    expect(readinessAnchor("veto_invalid")).toBe("veto");
    expect(readinessAnchor("veto_without_checkin")).toBe("checkin");
    expect(readinessAnchor("neu_und_unbekannt")).toBe("");
    for (const anchor of ["modi", "serie", "veto", "regelwerk", "selbstanmeldung", "staffeln"]) expect(seasonTarget(`#${anchor}`).tab).not.toBe("ueberblick");
    expect(seasonTarget("#veto")).toEqual({ tab: "spielbetrieb", section: "veto" });
  });
});

describe("Felder je Reiter - jede Angabe an genau einer Stelle", () => {
  it("jedes Formularfeld der Season gehört genau einem Reiter", () => {
    const owners = {};
    for (const [tab, fields] of Object.entries(TAB_FIELDS)) {
      expect(SEASON_TABS.map((row) => row.key)).toContain(tab);
      for (const key of fields) {
        expect(owners[key], `${key} steht in ${owners[key]} und ${tab}`).toBeUndefined();
        owners[key] = tab;
      }
    }
    expect(Object.keys(owners).sort()).toEqual(Object.keys(seasonToForm(SEASON)).sort());
  });

  it("jedes Feld der Anfrage gehört genau einem Reiter", () => {
    const form = { ...seasonToForm(SEASON), had_rules: true, had_application: true };
    const all = Object.values(TAB_PAYLOAD_KEYS).flat();
    expect(new Set(all).size).toBe(all.length);
    expect([...all].sort()).toEqual(Object.keys(seasonPayload(form)).sort());
  });

  it("ein Reiter schickt nur seine Felder - mit dem gespeicherten Stand der übrigen", () => {
    const saved = seasonToForm(SEASON);
    const form = { ...saved, weeks_total: "12", name: "Season Eins", points_win: "2" };
    expect(tabPayload("termine", form, saved)).toEqual({
      start_date: "2026-11-09T23:00:00.000Z", weeks_total: 12, matchday_days: 7, default_match_weekday: 6, default_match_time: "20:00",
      round_robin_legs: 1, blocked_periods: [], match_schedule_response_hours: null,
    });
    expect(tabPayload("ueberblick", form, saved)).toMatchObject({ name: "Season Eins", visibility: "off", status: "draft" });
    expect(tabPayload("ueberblick", form, saved)).not.toHaveProperty("weeks_total");
    expect(tabPayload("tabelle", form, saved).scoring_rules.match_points).toEqual({ win: 2, draw: 0, loss: 0 });
    expect(Object.keys(tabPayload("regelwerk", form, saved))).toEqual(["rules_text"]);
  });

  it("Modus je Map: unverändert geht die gespeicherte Reihenfolge genau so mit (Altbestand, #2207)", () => {
    const saved = seasonToForm({ ...SEASON, game_mode_order: ["snd", "stellung"] });
    expect(tabPayload("spielbetrieb", saved, saved, { maps: 3, savedOrder: ["snd", "stellung"] }).game_mode_order).toEqual(["snd", "stellung"]);
  });

  it("Punkt am Reiter nur, wo sich etwas geändert hat", () => {
    const saved = seasonToForm(SEASON);
    const dirty = dirtyTabs({ ...saved, weeks_total: "12", table_tiebreakers: ["score_for"] }, saved);
    expect(Object.entries(dirty).filter(([, on]) => on).map(([tab]) => tab).sort()).toEqual(["tabelle", "termine"]);
    expect(Object.values(dirtyTabs(saved, saved)).some(Boolean)).toBe(false);
  });

  it("nach dem Speichern: der gespeicherte Reiter und unberührte nehmen den neuen Stand, ungespeicherte bleiben", () => {
    const old = seasonToForm(SEASON);
    const fresh = seasonToForm({ ...SEASON, weeks_total: 12, name: "Von woanders" });
    const form = { ...old, weeks_total: "12", points_win: "2" };
    const next = rebaseForm(form, old, fresh, ["termine"]);
    expect(next.weeks_total).toBe("12");
    expect(next.name).toBe("Von woanders");
    expect(next.points_win).toBe("2");
  });
});

describe("Ablaufleiste", () => {
  const phase = (input) => seasonPhases({ season: SEASON, calendar: null, divisions: [], ...input });
  const current = (steps) => steps.find((step) => step.state === "current")?.key;

  it("vor dem Anmeldefenster: Vorbereitung, danach Anmeldung, Einteilung, Spielbetrieb", () => {
    expect(current(phase({ now: new Date("2026-10-20T10:00:00Z") }))).toBe("vorbereitung");
    const open = phase({ now: new Date("2026-11-02T10:00:00Z") });
    expect(current(open)).toBe("anmeldung");
    expect(open[0].state).toBe("done");
    expect(current(phase({ now: new Date("2026-11-08T10:00:00Z") }))).toBe("einteilung");
    const live = [{ id: "d1", status: "active", staffeln: [{ status: "live", participant_count: 8 }] }];
    expect(current(phase({ now: new Date("2026-11-12T10:00:00Z"), divisions: live, season: { ...SEASON, status: "active" } }))).toBe("spielbetrieb");
  });

  it("ohne Fenster gibt es keine Anmeldung - sie steht als „ohne Selbstanmeldung“ da", () => {
    const steps = phase({ season: { ...SEASON, application_opens_at: null, application_closes_at: null }, now: new Date("2026-10-20T10:00:00Z") });
    expect(steps.find((step) => step.key === "anmeldung")).toMatchObject({ state: "skipped" });
    expect(current(steps)).toBe("vorbereitung");
  });

  it("nennt im Spielbetrieb die Spielwoche und schließt mit „Beendet“ ab", () => {
    const calendar = { weeks: [{ number: 1, start_day: "2026-11-10", end_day: "2026-11-16", blocked: false }, { number: 2, start_day: "2026-11-17", end_day: "2026-11-23", blocked: false }] };
    const live = [{ id: "d1", status: "active", staffeln: [{ status: "live" }] }];
    const steps = phase({ calendar, divisions: live, season: { ...SEASON, status: "active" }, now: new Date("2026-11-18T10:00:00Z") });
    expect(steps.find((step) => step.key === "spielbetrieb").note).toBe("Spielwoche 2 von 2");
    expect(current(phase({ season: { ...SEASON, status: "completed" }, now: new Date("2027-02-01T10:00:00Z") }))).toBe("abschluss");
  });
});

describe("Liga-Stand einer Staffel (#2453)", () => {
  const STAFFEL = {
    id: "t1", status: "draft", participant_count: 1, max_participants: 8, min_participants: 2,
    league_context: { league_id: "l1", season_id: "s1", division_id: "d1", staffel: "A" },
  };
  // Veröffentlicht - eine verborgene Season hat eigene Fälle (Review #2453, 5c).
  const OPEN = { ...SEASON, visibility: "public" };
  const stand = (staffel, now, season = OPEN) => staffelStand({ ...STAFFEL, ...staffel }, { season, now: new Date(now) });

  it("eine Staffel im Entwurf zeigt den Stand der Season, je Phase wie die Ablaufleiste", () => {
    expect(stand({}, "2026-10-20T10:00:00Z")).toMatchObject({ key: "vorbereitung", label: "Vorbereitung", filter: "league:vorbereitung" });
    expect(stand({}, "2026-11-02T10:00:00Z")).toMatchObject({ key: "anmeldung", label: "Anmeldung offen bis 06.11., 23:59" });
    expect(stand({}, "2026-11-08T10:00:00Z")).toMatchObject({ key: "einteilung", label: "Einteilung" });
    expect(stand({ status: "live" }, "2026-11-12T10:00:00Z", { ...OPEN, status: "active" })).toMatchObject({ key: "spielbetrieb", label: "Spielbetrieb", live: true });
    expect(stand({ status: "paused" }, "2026-11-12T10:00:00Z", { ...OPEN, status: "active" })).toMatchObject({ label: "Spielbetrieb · pausiert", live: false });
    expect(stand({ status: "completed" }, "2027-02-01T10:00:00Z", { ...SEASON, status: "active" })).toMatchObject({ key: "abschluss", label: "Abgeschlossen" });
    expect(stand({ status: "results_published" }, "2027-02-01T10:00:00Z", { ...SEASON, status: "completed" })).toMatchObject({ key: "abschluss" });
  });

  it("dieselbe Quelle wie die Ablaufleiste: die aktuelle Phase ist dieselbe", () => {
    for (const now of ["2026-10-20T10:00:00Z", "2026-11-02T10:00:00Z", "2026-11-08T10:00:00Z"]) {
      const bar = seasonPhases({ season: OPEN, divisions: [{ status: "active", staffeln: [{ status: "draft", participant_count: 1 }] }], now: new Date(now) });
      expect(stand({}, now).key).toBe(bar.find((step) => step.state === "current").key);
    }
  });

  it("ein gewöhnliches Turnier, eine abgesagte oder archivierte Staffel und eine ohne Season-Angaben behalten ihren Status", () => {
    expect(staffelStand({ id: "x", status: "draft" }, { season: SEASON })).toBeNull();
    expect(stand({ status: "cancelled" }, "2026-11-02T10:00:00Z")).toBeNull();
    expect(stand({ status: "archived" }, "2026-11-02T10:00:00Z")).toBeNull();
    expect(staffelStand(STAFFEL)).toBeNull();
    expect(statusFilterKeys({ id: "x", status: "draft" })).toEqual(["draft"]);
    expect(statusFilterKeys({ ...STAFFEL, league_season: OPEN }, new Date("2026-11-02T10:00:00Z"))).toEqual(["league:anmeldung"]);
    expect(statusFilterKeys({ ...STAFFEL, status: "archived", league_season: OPEN })).toEqual(["archived"]);
  });

  it("der Filter kennt jeden Stand", () => {
    expect(STAFFEL_STAND_FILTERS.map(([value]) => value)).toEqual(["league:vorbereitung", "league:anmeldung", "league:einteilung", "league:spielbetrieb", "league:abschluss"]);
    expect(STAFFEL_STAND_FILTERS[1][1]).toBe("Liga: Anmeldung offen");
  });

  it("was fehlt: Teams zuteilen mit dem Weg in den Eingang, ohne Anmeldefenster in die Teilnehmerliste", () => {
    const needs = (staffel, now, season = OPEN) => staffelNeeds({ ...STAFFEL, ...staffel }, { season, now: new Date(now) });
    expect(needs({}, "2026-11-02T10:00:00Z")).toEqual([{ code: "assign", text: "Teams zuteilen · 1 von 8", to: "/admin/leagues/seasons/s1#anmeldungen" }]);
    const noWindow = { ...OPEN, application_opens_at: null, application_closes_at: null };
    expect(needs({ participant_count: 0 }, "2026-11-02T10:00:00Z", noWindow)[0]).toMatchObject({ code: "assign", to: "/admin/tournaments/t1?tab=participants" });
    // Während der Anmeldung kommen noch Teams - danach fehlt der Start.
    expect(needs({ participant_count: 4 }, "2026-11-02T10:00:00Z")).toEqual([]);
    expect(needs({ participant_count: 4 }, "2026-11-08T10:00:00Z")).toEqual([{ code: "start", text: "Spielplan noch nicht erzeugt – Liga starten", to: "/admin/tournaments/t1" }]);
    // Gestartet ohne feste Spiele - nur, wenn der Server es sagt.
    const active = { ...OPEN, status: "active" };
    expect(needs({ status: "live", participant_count: 4, league_plan: { fixed_matches: 0 } }, "2026-11-12T10:00:00Z", active)[0])
      .toMatchObject({ code: "plan", to: "/admin/tournaments/t1?tab=matchplan" });
    expect(needs({ status: "live", participant_count: 4, league_plan: { fixed_matches: 6 } }, "2026-11-12T10:00:00Z", active)).toEqual([]);
    expect(needs({ status: "live", participant_count: 4 }, "2026-11-12T10:00:00Z", active)).toEqual([]);
    expect(needs({ status: "cancelled", participant_count: 0 }, "2026-11-12T10:00:00Z")).toEqual([]);
    expect(staffelNeeds({ id: "x", status: "draft", participant_count: 0 })).toEqual([]);
  });

  it("Filter: nur der Entwurf weicht dem Liga-Stand, Live, Pausiert und Beendet passen weiter auf ihren Status (Review #2453, 1)", () => {
    const active = { ...OPEN, status: "active" };
    expect(statusFilterKeys({ ...STAFFEL, status: "live", league_season: active }, new Date("2026-11-12T10:00:00Z"))).toEqual(["live", "league:spielbetrieb"]);
    expect(statusFilterKeys({ ...STAFFEL, status: "paused", league_season: active }, new Date("2026-11-12T10:00:00Z"))).toEqual(["paused", "league:spielbetrieb"]);
    expect(statusFilterKeys({ ...STAFFEL, status: "completed", league_season: active }, new Date("2027-02-01T10:00:00Z"))).toEqual(["completed", "league:abschluss"]);
    expect(statusFilterKeys({ ...STAFFEL, status: "live" }, new Date("2026-11-12T10:00:00Z"))).toEqual(["live"]);
  });

  it("Nachmeldefrist kürzer als das Fenster: Label und Phasengrenze nehmen das wirksame Ende (Review #2453, 2)", () => {
    // Fenster bis 30.11., Start 10.11., Frist 2 Tage: wirksam bis 11.11. 23:00 UTC = 12.11. 00:00 Wien.
    const late = { ...OPEN, application_closes_at: "2026-11-29T23:00:00+00:00", late_registration_days: 2 };
    expect(applicationEnd(late)).toBe(new Date("2026-11-11T23:00:00Z").getTime());
    expect(stand({}, "2026-11-11T10:00:00Z", late)).toMatchObject({ key: "anmeldung", label: "Anmeldung offen bis 12.11., 00:00" });
    // Nach dem wirksamen Ende, vor dem Fensterende: nicht mehr Anmeldung.
    expect(stand({}, "2026-11-20T10:00:00Z", late).key).toBe("einteilung");
    const bar = seasonPhases({ season: late, divisions: [], now: new Date("2026-11-20T10:00:00Z") });
    expect(bar.find((step) => step.state === "current").key).toBe("einteilung");
    expect(bar.find((step) => step.key === "anmeldung").when).toMatch(/– 12\.11\., 00:00$/);
    // Vom Server geliefert geht vor.
    const served = { ...late, application_effective_closes_at: "2026-11-15T11:00:00+00:00" };
    expect(stand({}, "2026-11-14T10:00:00Z", served).label).toBe("Anmeldung offen bis 15.11., 12:00");
    // Endet das Fenster vor dem Start, gilt es selbst.
    expect(applicationEnd(OPEN)).toBe(new Date(OPEN.application_closes_at).getTime());
  });

  it("Season läuft, diese Staffel noch nicht gestartet: Einteilung mit fehlendem Start, nicht Spielbetrieb (Review #2453, 5a)", () => {
    const active = { ...OPEN, status: "active" };
    expect(stand({ participant_count: 4 }, "2026-11-12T10:00:00Z", active)).toMatchObject({ key: "einteilung", label: "Einteilung · Start fehlt", live: false });
    const needs = staffelNeeds({ ...STAFFEL, participant_count: 4 }, { season: active, now: new Date("2026-11-12T10:00:00Z") });
    expect(needs.map((row) => row.code)).toEqual(["start"]);
    expect(statusFilterKeys({ ...STAFFEL, league_season: active }, new Date("2026-11-12T10:00:00Z"))).toEqual(["league:einteilung"]);
  });

  it("beendete oder archivierte Season: keine fehlenden Punkte für eine nie gestartete Staffel (Review #2453, 5b)", () => {
    for (const status of ["completed", "archived"]) {
      expect(staffelNeeds({ ...STAFFEL, participant_count: 0 }, { season: { ...OPEN, status }, now: new Date("2027-02-01T10:00:00Z") })).toEqual([]);
    }
  });

  it("verborgene Season mit offenem Fenster: kein grünes „Anmeldung offen“, dafür „Sichtbarkeit einschalten“ (Review #2453, 5c)", () => {
    for (const visibility of ["off", "admins"]) {
      const hidden = { ...OPEN, visibility };
      expect(stand({}, "2026-11-02T10:00:00Z", hidden)).toMatchObject({ key: "anmeldung", hidden: true, label: "Anmeldung offen bis 06.11., 23:59 · Season verborgen" });
      const needs = staffelNeeds(STAFFEL, { season: hidden, now: new Date("2026-11-02T10:00:00Z") });
      expect(needs[0]).toEqual({ code: "visibility", text: "Sichtbarkeit einschalten – Teams sehen die Anmeldung nicht", to: "/admin/leagues/seasons/s1" });
    }
    expect(stand({}, "2026-11-02T10:00:00Z", { ...OPEN, visibility: "members" }).hidden).toBe(false);
  });

  it("vor dem Fensterbeginn kein „Teams zuteilen“ (Review #2453, 5d)", () => {
    expect(staffelNeeds({ ...STAFFEL, participant_count: 0 }, { season: OPEN, now: new Date("2026-10-20T10:00:00Z") })).toEqual([]);
    // Ohne Fenster teilt die Leitung von Anfang an zu.
    const noWindow = { ...OPEN, application_opens_at: null, application_closes_at: null };
    expect(staffelNeeds({ ...STAFFEL, participant_count: 0 }, { season: noWindow, now: new Date("2026-10-20T10:00:00Z") })[0]).toMatchObject({ code: "assign" });
  });
});

describe("Hinweise", () => {
  it("Beiname, der „Liga N“ wiederholt", () => {
    expect(nicknameRepeatsLevel("Liga 1")).toBe(true);
    expect(nicknameRepeatsLevel("  liga   2 ")).toBe(true);
    expect(nicknameRepeatsLevel("Liga1")).toBe(true);
    expect(nicknameRepeatsLevel("Elite")).toBe(false);
    expect(nicknameRepeatsLevel("Liga der Löwen")).toBe(false);
    expect(nicknameRepeatsLevel("")).toBe(false);
  });

  it("Pool und Modus je Map passen nicht zusammen", () => {
    const label = (mode) => ({ snd: "Suchen & Zerstören", stellung: "Stellung", kontrolle: "Kontrolle" })[mode] || mode;
    expect(orderPoolHints(["snd", "stellung", "snd"], ["snd"], label)).toEqual([
      "„Stellung“ steht in „Modus je Map“, hat aber keine Maps im Pool.",
    ]);
    expect(orderPoolHints(["snd", "snd", "snd"], ["snd", "kontrolle"], label)).toEqual([
      "„Kontrolle“ hat Maps im Pool, kommt in „Modus je Map“ aber nie vor.",
    ]);
    expect(orderPoolHints([], ["snd"], label)).toEqual([]);
    expect(orderPoolHints(["snd", "", ""], ["snd"], label)).toEqual([]);
  });

  it("Regelwerk: fehlt, Entwurf nicht freigegeben, Daten geändert", () => {
    expect(rulesNotice(null, { problems: [{ code: "rules_missing" }] })).toMatchObject({ kind: "missing" });
    // Ohne gültige Fassung, aber mit Entwurf: Der Entwurf muss freigegeben werden - das sagt die Prüfung nicht.
    expect(rulesNotice({ current: null, versions: [], draft: { revision: 1 } }, { problems: [{ code: "rules_missing" }] })).toMatchObject({ kind: "draft" });
    expect(rulesNotice({ current: { label: "Version 1" }, draft: { revision: 2 } }, null)).toMatchObject({ kind: "draft" });
    expect(rulesNotice({ current: { label: "Version 1" }, data_changes: { label: "Version 1", rows: [{}, {}] } }, null))
      .toMatchObject({ kind: "changed", text: expect.stringContaining("2 Bausteine") });
    // Variablen (#2269) zählen eigens.
    expect(rulesNotice({ current: { label: "Version 1" }, data_changes: { label: "Version 1", rows: [{ kind: "block" }, { kind: "variable" }, { kind: "variable" }] } }, null))
      .toMatchObject({ kind: "changed", text: expect.stringContaining("1 Baustein, 2 Variablen") });
    expect(changedPlaces([{ kind: "variable" }])).toBe("1 Variable");
    expect(rulesNotice({ current: { label: "Version 1" }, draft: null, data_changes: null }, { problems: [] })).toBeNull();
  });
});
