// Rechte je Spiel (#1353, nach Codex-Prüfung): ein Helfer-Einsatz kann an das ganze Turnier oder an ein Spiel, eine Phase,
// eine Gruppe oder eine Station gebunden sein. Der Server schickt die turnierweiten Rechte als Felder
// (`can_manage_all_results`, `can_plan_matches`) und die gebundenen Einsätze in `staff_scopes`. Hier dieselbe Regel wie
// `has_match_result_permission` (Ergebnisse: Spiel, Phase, Gruppe, Station) und `PATCH /matches` (Termin und Station:
// nur genau dieses Spiel) - damit das Web keinen Knopf zeigt, den der Server für dieses Spiel ablehnt.

const FIELD = { match: "id", stage: "stage_id", group: "group_id", station: "station_id" };

function covers(scope, match) {
  const field = FIELD[scope?.scope];
  if (!field || !match) return false;
  // Ohne scope_id gilt der Einsatz für jedes Spiel, das diesen Teil hat - wie im Server.
  if (!scope.scope_id) return Boolean(match[field]);
  return match[field] === scope.scope_id;
}

export function matchRights(tournament, match) {
  const scopes = Array.isArray(tournament?.staff_scopes) ? tournament.staff_scopes : [];
  return {
    results: Boolean(tournament?.can_manage_all_results) || scopes.some((scope) => scope.results && covers(scope, match)),
    plan: Boolean(tournament?.can_plan_matches) || scopes.some((scope) => scope.plan && covers(scope, match)),
  };
}
