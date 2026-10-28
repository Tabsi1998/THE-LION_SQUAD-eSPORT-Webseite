import { modeOrderProblem, overridesPayload, overridesToForm, seasonPayload, seasonToForm, settingsLine, syncSummary, weekdayName } from "./league";

// Liga verwalten (docs/LIGA.md, #1622): Formular ↔ Anfrage. Der Beginn ist ein Wiener Kalendertag (00:00 Wien).

const SEASON = {
  name: "Season 1", start_date: "2026-11-09T23:00:00+00:00", weeks_total: 10, matchday_days: 7, default_match_weekday: 6,
  default_match_time: "20:00", round_robin_legs: 1, max_staffel_size: 8, best_of: 3, team_size: 4, min_squad_size: 4,
  game_mode_order: [], result_confirm_hours: 48, lineup_amend_hours: 48, rules_text: "Fair spielen", visibility: "off", status: "draft",
  registration_deadline: "2026-11-06",
  blocked_periods: [{ start_date: "2026-12-21", end_date: "2027-01-03", label: "Weihnachtspause" }],
  scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 }, table_tiebreakers: ["score_diff", "score_for"], points_mode: "scheme" },
};

test("eine Season wird zum Formular und unverändert wieder zur Anfrage", () => {
  const form = seasonToForm(SEASON);
  expect(form.start_day).toBe("2026-11-10");
  expect(form.weeks_total).toBe("10");
  const body = seasonPayload(form);
  expect(body.start_date).toBe("2026-11-09T23:00:00.000Z");
  expect(body).toMatchObject({ weeks_total: 10, best_of: 3, round_robin_legs: 1, default_match_weekday: 6, visibility: "off",
    registration_deadline: "2026-11-06", rules_text: "Fair spielen", game_mode_order: [] });
  expect(body.blocked_periods).toEqual(SEASON.blocked_periods);
  // Die übrigen Regeln der Wertung bleiben, wie sie gespeichert sind.
  expect(body.scoring_rules).toMatchObject({ points_mode: "scheme", match_points: { win: 3, draw: 1, loss: 0 } });
});

test("halb ausgefüllte Sperrzeiten und leere Texte gehen nicht mit", () => {
  const form = { ...seasonToForm(SEASON), rules_text: "  ", blocked_periods: [{ start_date: "2026-12-01", end_date: "", label: "" }] };
  const body = seasonPayload(form);
  expect(body.rules_text).toBeNull();
  expect(body.blocked_periods).toEqual([]);
});

test("Modus je Map: alle frei oder jede Position belegt", () => {
  expect(modeOrderProblem([], 3)).toBe("");
  expect(modeOrderProblem(["snd", "", ""], 3)).toMatch(/jede Map/);
  expect(modeOrderProblem(["snd", "stellung", "snd"], 3)).toBe("");
  expect(seasonPayload({ ...seasonToForm(SEASON), game_mode_order: ["snd", "", "snd"] }).game_mode_order).toEqual([]);
  expect(seasonPayload({ ...seasonToForm(SEASON), game_mode_order: ["snd", "stellung", "snd", "x"] }).game_mode_order).toEqual(["snd", "stellung", "snd"]);
});

test("Liga N: nur abweichende Werte, leer heißt wie die Season", () => {
  expect(overridesPayload(overridesToForm({}))).toEqual({});
  const form = { ...overridesToForm({}), best_of: "5", points_win: "2" };
  expect(overridesPayload(form)).toEqual({ best_of: 5, scoring_rules: { match_points: { win: 2, draw: 1, loss: 0 } } });
  expect(overridesToForm({ team_size: 5 }).team_size).toBe("5");
});

test("Texte für Liga N und das Übertragen", () => {
  expect(weekdayName(6)).toBe("Sonntag");
  expect(settingsLine({ best_of: 3, team_size: 4, max_staffel_size: 8, scoring_rules: { match_points: { win: 3, draw: 1, loss: 0 } } }))
    .toBe("Best of 3 · 4 gegen 4 · bis 8 Teams je Staffel · Punkte 3/1/0");
  const summary = syncSummary({ applied: ["always", "map_pool"], changed: ["rules"], skipped: [{ label: "Termine und Kalender", reason: "Die Staffel hat schon begonnen." }] });
  expect(summary.head).toBe("1 Wert übernommen");
  expect(summary.applied).toEqual(["Sichtbarkeit und Regeltext", "Map-Pool"]);
  expect(summary.skipped).toEqual(["Termine und Kalender: Die Staffel hat schon begonnen."]);
});
