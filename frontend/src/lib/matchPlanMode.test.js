import { describe, expect, it } from "vitest";
import fixture from "../../e2e/fixtures/matchplanGenerated.json";
import { eventModeOf, planViewMode, playsInMatchdays } from "./matchPlanMode";

// Welche Ansicht die Matchplan-Seite zeigt (Codex zu #1601): dieselbe Regel wie der Planer im Backend
// (services/tournament_rules.match_policy, services/matchday_schedule.plays_in_matchdays). Nur „vor Ort“ plant
// Stationen - „hybrid“ nicht; Spielwochen gibt es nur, wenn nicht vor Ort gespielt wird.

describe("eventModeOf - wie match_policy", () => {
  it("Spiel vor Spiel-Einstellung vor Phase vor Turnier vor alten Schaltern, sonst online", () => {
    expect(eventModeOf({}, { event_mode: "local" })).toBe("local");
    expect(eventModeOf({}, { event_mode: "hybrid" })).toBe("hybrid");
    expect(eventModeOf({}, { event_mode: "online" }, { settings: { event_mode: "local" } })).toBe("local");
    expect(eventModeOf({}, { event_mode: "online" }, { event_mode: "local" })).toBe("local");
    expect(eventModeOf({ settings: { event_mode: "online" } }, { event_mode: "local" })).toBe("online");
    expect(eventModeOf({ event_mode: "local" }, { event_mode: "online" })).toBe("local");
    expect(eventModeOf({}, { is_hybrid: true })).toBe("hybrid");
    expect(eventModeOf({}, { is_online: true })).toBe("online");
    expect(eventModeOf({}, {})).toBe("online");
    expect(eventModeOf({}, { event_mode: "quatsch" })).toBe("online");
  });
});

describe("playsInMatchdays - wie im Backend", () => {
  it("Liga, Jeder gegen jeden und Gruppen spielen online in Wochen, vor Ort nie", () => {
    expect(playsInMatchdays({ format: "league", event_mode: "online" })).toBe(true);
    expect(playsInMatchdays({ format: "groups", event_mode: "hybrid" })).toBe(true);
    expect(playsInMatchdays({ format: "league", event_mode: "local" })).toBe(false);
    expect(playsInMatchdays({ format: "single_elim", event_mode: "online" })).toBe(false);
    expect(playsInMatchdays({ format: "single_elim", event_mode: "online" }, { stage_type: "league" })).toBe(true);
  });
});

describe("planViewMode", () => {
  it("vor Ort bleibt vor Ort - auch wenn der Planer „none“ meldet (Baum noch Vorschau)", () => {
    const state = fixture.draft;
    expect(planViewMode({ tournament: state.tournament, stages: state.stages, matches: state.matches, plan: state.plan })).toBe("local");
    expect(planViewMode({ tournament: state.tournament, stages: state.stages, matches: state.matches, plan: null })).toBe("local");
  });

  it("hybrid plant keine Stationen: ohne Antwort des Planers die Online-Ansicht, wie der Planer", () => {
    const tournament = { ...fixture.online.tournament, event_mode: "hybrid" };
    expect(planViewMode({ tournament, stages: [], matches: [], plan: null })).toBe("online");
    expect(planViewMode({ tournament: { ...tournament, format: "league" }, stages: [], matches: [], plan: null })).toBe("league");
  });

  it("eine Phase vor Ort in einem sonst hybriden Turnier: die Stationsansicht", () => {
    const tournament = { event_mode: "hybrid", format: "single_elim" };
    expect(planViewMode({ tournament, stages: [{ id: "s1", settings: { event_mode: "local" } }], matches: [{ id: "m", stage_id: "s1" }], plan: null })).toBe("local");
  });

  it("die Antwort des Planers bestätigt: Stationen, Spielwochen", () => {
    expect(planViewMode({ tournament: { event_mode: "online" }, matches: [], plan: { mode: "stations" } })).toBe("local");
    expect(planViewMode({ tournament: { event_mode: "online" }, matches: [], plan: { mode: "matchdays" } })).toBe("league");
    expect(planViewMode({ tournament: fixture.league.tournament, stages: fixture.league.stages, matches: fixture.league.matches, plan: null })).toBe("league");
    expect(planViewMode({ tournament: fixture.online.tournament, stages: fixture.online.stages, matches: fixture.online.matches, plan: fixture.online.plan })).toBe("online");
  });
});
