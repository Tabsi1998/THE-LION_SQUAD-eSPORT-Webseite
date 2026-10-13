import { matchRights } from "./tournamentRights";

// Rechte je Spiel (#1353): turnierweit für alle Spiele, ein gebundener Einsatz nur für die Spiele, die er abdeckt.
const MATCH = { id: "m-1", stage_id: "s-1", group_id: "g-1", station_id: "st-1" };
const OTHER = { id: "m-2", stage_id: "s-2", group_id: "g-2", station_id: "st-2" };

test("turnierweiter Einsatz: alle Spiele", () => {
  const t = { can_manage_all_results: true, can_plan_matches: true, staff_scopes: [] };
  expect(matchRights(t, MATCH)).toEqual({ results: true, plan: true });
  expect(matchRights(t, OTHER)).toEqual({ results: true, plan: true });
});

test("an ein Spiel gebunden: Ergebnis und Termin nur dort", () => {
  const t = { can_manage_results: true, staff_scopes: [{ scope: "match", scope_id: "m-1", results: true, plan: true }] };
  expect(matchRights(t, MATCH)).toEqual({ results: true, plan: true });
  expect(matchRights(t, OTHER)).toEqual({ results: false, plan: false });
});

test("an eine Station gebunden: Ergebnisse an dieser Station, Termin nirgends", () => {
  const t = { staff_scopes: [{ scope: "station", scope_id: "st-1", results: true, plan: false }] };
  expect(matchRights(t, MATCH)).toEqual({ results: true, plan: false });
  expect(matchRights(t, OTHER)).toEqual({ results: false, plan: false });
  expect(matchRights(t, { id: "m-3" })).toEqual({ results: false, plan: false });
});

test("Phase und Gruppe; ohne Einsatz nichts", () => {
  expect(matchRights({ staff_scopes: [{ scope: "stage", scope_id: "s-2", results: true }] }, OTHER).results).toBe(true);
  expect(matchRights({ staff_scopes: [{ scope: "group", scope_id: "g-1", results: true }] }, OTHER).results).toBe(false);
  expect(matchRights({}, MATCH)).toEqual({ results: false, plan: false });
});
