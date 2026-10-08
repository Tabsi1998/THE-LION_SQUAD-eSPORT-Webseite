// „Automatisch“ (#1132, Entscheidung B): online und hybrid melden die Spieler selbst, vor Ort trägt die Turnierleitung
// ein. Dieselben Fälle prüft der Server (backend/tests/test_match_policy_unit.py) - Admin-Liste, Planungs-Warnung und
// Matchseite sagen dasselbe.
import { effectiveRuleModes, rulePresetKey, rulePresetWarnings } from "./tournamentRulePresets";

test.each([
  [{ event_mode: "online" }, { event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal" }],
  [{ event_mode: "hybrid" }, { event_mode: "hybrid", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal" }],
  [{ event_mode: "local" }, { event_mode: "local", result_entry_mode: "staff_only", schedule_mode: "fixed_by_staff" }],
  [{ is_hybrid: true }, { event_mode: "hybrid", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal" }],
  [{}, { event_mode: "online", result_entry_mode: "player_confirmed", schedule_mode: "player_proposal" }],
  [{ event_mode: "online", result_entry_mode: "staff_only" }, { event_mode: "online", result_entry_mode: "staff_only", schedule_mode: "player_proposal" }],
])("ohne eigene Angabe rechnet der Admin wie der Server: %j", (source, expected) => {
  expect(effectiveRuleModes(source)).toEqual(expected);
});

test("Vorlagen und Warnungen", () => {
  expect(rulePresetKey({ event_mode: "online" })).toBe("online");
  expect(rulePresetKey({ event_mode: "local" })).toBe("local");
  expect(rulePresetWarnings({ event_mode: "online", result_entry_mode: "staff_only" })).toEqual(["Online-Turnier ohne Spieler-Ergebnismeldung."]);
  expect(rulePresetWarnings({ event_mode: "online" })).toEqual([]);
});
