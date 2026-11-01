import { matchdayDrawMode, matchdayDrawOn, tournamentFieldRules } from "./tournamentFormFields";

// Formulare nach Format und Austragung (#2111): nur, was am Server etwas bewirkt.
test("Spielwochen nur in Wochenformaten und nicht vor Ort (T1)", () => {
  expect(tournamentFieldRules({ format: "league", event_mode: "online" }).matchdays).toBe(true);
  expect(tournamentFieldRules({ format: "groups", event_mode: "hybrid" }).matchdays).toBe(true);
  expect(tournamentFieldRules({ format: "round_robin", event_mode: "local" }).matchdays).toBe(false);
  expect(tournamentFieldRules({ format: "single_elim", event_mode: "online" }).matchdays).toBe(false);
  // Ohne Austragung gilt online - wie am Server.
  expect(tournamentFieldRules({ format: "league" }).matchdays).toBe(true);
});

test("Weiterkommen nur mit Turnierbaum, Hin- und Rückrunde mit „Spieltage auslosen“ (T4)", () => {
  for (const format of ["single_elim", "double_elim", "custom_bracket", "ffa_custom_bracket"]) {
    expect(tournamentFieldRules({ format }).advancement, format).toBe("select");
  }
  expect(tournamentFieldRules({ format: "league" }).advancement).toBe("matchday_draw");
  for (const format of ["round_robin", "groups", "swiss", "ffa", "battle_royale", "time_trial", "grand_prix"]) {
    expect(tournamentFieldRules({ format }).advancement, format).toBeNull();
  }
  expect(matchdayDrawOn("draw_show")).toBe(true);
  expect(matchdayDrawOn("fixed")).toBe(false);
  expect(matchdayDrawMode(true)).toBe("draw_round");
  expect(matchdayDrawMode(false)).toBe("fixed");
});

test("Fristen je Austragung und Format (T2)", () => {
  expect(tournamentFieldRules({ format: "single_elim", event_mode: "local" }).deadlines).toEqual({
    no_show_minutes_on_site: true, no_show_minutes_online: false, result_confirm_minutes_online: false, result_confirm_hours_league: false,
  });
  expect(tournamentFieldRules({ format: "single_elim", event_mode: "online" }).deadlines).toEqual({
    no_show_minutes_on_site: false, no_show_minutes_online: true, result_confirm_minutes_online: true, result_confirm_hours_league: false,
  });
  expect(tournamentFieldRules({ format: "league", event_mode: "hybrid" }).deadlines).toEqual({
    no_show_minutes_on_site: true, no_show_minutes_online: true, result_confirm_minutes_online: false, result_confirm_hours_league: true,
  });
});
