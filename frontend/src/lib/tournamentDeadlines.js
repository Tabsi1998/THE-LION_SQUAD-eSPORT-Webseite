// Fristen je Turnier (#1551): „nicht erschienen“ und „Ergebnis gilt“. Leer heißt Standard - dieselben Werte wie im
// Server (backend/services/match_deadlines.py). Eine Phase kann sie in ihren Einstellungen überschreiben.

export const DEADLINE_FIELDS = [
  { key: "no_show_minutes_on_site", label: "Nicht erschienen vor Ort (Min. ab Aufruf)", fallback: 10, max: 120, testId: "tr-edit-no-show-on-site" },
  { key: "no_show_minutes_online", label: "Nicht erschienen online (Min. ab Spielbeginn)", fallback: 15, max: 240, testId: "tr-edit-no-show-online" },
  { key: "result_confirm_minutes_online", label: "Ergebnis gilt online nach (Min.)", fallback: 15, max: 1440, testId: "tr-edit-confirm-online" },
  { key: "result_confirm_hours_league", label: "Ergebnis gilt in der Liga nach (Std.)", fallback: 48, max: 336, testId: "tr-edit-confirm-league" },
];

export function deadlineFormValues(source = {}) {
  return Object.fromEntries(DEADLINE_FIELDS.map(({ key }) => [key, source?.[key] == null ? "" : String(source[key])]));
}

export function deadlinePayload(form = {}) {
  return Object.fromEntries(DEADLINE_FIELDS.map(({ key, max }) => {
    const value = Number(String(form[key] ?? "").trim());
    return [key, Number.isInteger(value) && value >= 1 && value <= max ? value : null];
  }));
}
