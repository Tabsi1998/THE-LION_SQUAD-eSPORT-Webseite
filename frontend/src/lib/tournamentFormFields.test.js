import { tournamentFieldRules } from "./tournamentFormFields";

// Formulare nach Format und Austragung (#2111): nur, was am Server etwas bewirkt.
test("Spielwochen nur in Wochenformaten und nicht vor Ort (T1)", () => {
  expect(tournamentFieldRules({ format: "league", event_mode: "online" }).matchdays).toBe(true);
  expect(tournamentFieldRules({ format: "groups", event_mode: "hybrid" }).matchdays).toBe(true);
  expect(tournamentFieldRules({ format: "round_robin", event_mode: "local" }).matchdays).toBe(false);
  expect(tournamentFieldRules({ format: "single_elim", event_mode: "online" }).matchdays).toBe(false);
  // Ohne Austragung gilt online - wie am Server.
  expect(tournamentFieldRules({ format: "league" }).matchdays).toBe(true);
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
