import { describe, expect, it } from "vitest";
import { seasonPayload, seasonToForm } from "./league";
import {
  SEASON_TABS, TAB_FIELDS, TAB_PAYLOAD_KEYS, changedPlaces, dirtyTabs, nicknameRepeatsLevel, orderPoolHints, readinessAnchor, rebaseForm, rulesNotice,
  seasonAnchorUrl, seasonPhases, seasonTarget, tabPayload,
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
