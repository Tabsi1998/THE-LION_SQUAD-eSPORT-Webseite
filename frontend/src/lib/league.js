// Liga verwalten (docs/LIGA.md, #1622): Formularwerte einer Season ↔ Anfrage an /api/admin/leagues. Die Regeln prüft der
// Server noch einmal (services/league_service.py); hier steht nur, was die Oberfläche selbst wissen muss.
import { fromViennaInput, viennaDay } from "@/lib/vienna";

export const VISIBILITY_OPTIONS = [
  ["off", "Aus – niemand sieht die Liga"],
  ["admins", "Nur Turnierleitung"],
  ["members", "Nur Mitglieder"],
  ["public", "Öffentlich"],
];
export const VISIBILITY_SHORT = { off: "Aus", admins: "Nur Turnierleitung", members: "Nur Mitglieder", public: "Öffentlich" };
export const SEASON_STATUS_OPTIONS = [["draft", "Entwurf"], ["active", "Läuft"], ["completed", "Beendet"], ["archived", "Archiviert"]];
export const WEEKDAY_OPTIONS = [["0", "Montag"], ["1", "Dienstag"], ["2", "Mittwoch"], ["3", "Donnerstag"], ["4", "Freitag"], ["5", "Samstag"], ["6", "Sonntag"]];
export const BEST_OF_OPTIONS = [["1", "Best of 1"], ["3", "Best of 3"], ["5", "Best of 5"], ["7", "Best of 7"]];
export const LEGS_OPTIONS = [["1", "Nur Hinrunde"], ["2", "Hin- und Rückrunde"]];
export const TIEBREAKER_LABELS = { score_diff: "Differenz", score_for: "Mehr gewonnene Maps", wins: "Mehr Siege" };
export const SYNC_GROUP_TEXT = {
  always: "Sichtbarkeit und Regeltext",
  before_start: "Termine und Kalender",
  before_result: "Best of, Teamgröße, Punkte und Fristen",
  map_pool: "Map-Pool",
};

const number = (value) => (value === "" || value == null ? null : Number(value));

/** Der Wochentag als Wort - „Sonntag“. */
export function weekdayName(value) {
  return (WEEKDAY_OPTIONS.find(([key]) => key === String(value)) || [null, ""])[1];
}

/** Eine Season als Formular - Zahlen als Text, der Beginn als Wiener Kalendertag. */
export function seasonToForm(season = {}) {
  const rules = season.scoring_rules || {};
  const points = rules.match_points || { win: 3, draw: 1, loss: 0 };
  return {
    name: season.name || "",
    start_day: season.start_date ? viennaDay(season.start_date) : "",
    weeks_total: String(season.weeks_total ?? 10),
    matchday_days: String(season.matchday_days ?? 7),
    default_match_weekday: String(season.default_match_weekday ?? 6),
    default_match_time: season.default_match_time || "20:00",
    round_robin_legs: String(season.round_robin_legs ?? 1),
    max_staffel_size: String(season.max_staffel_size ?? 8),
    best_of: String(season.best_of ?? 3),
    team_size: String(season.team_size ?? 4),
    min_squad_size: String(season.min_squad_size ?? season.team_size ?? 4),
    points_win: String(points.win ?? 3),
    points_draw: String(points.draw ?? 1),
    points_loss: String(points.loss ?? 0),
    table_tiebreakers: rules.table_tiebreakers || ["score_diff", "score_for"],
    game_mode_order: season.game_mode_order || [],
    result_confirm_hours: String(season.result_confirm_hours ?? 48),
    lineup_amend_hours: String(season.lineup_amend_hours ?? 48),
    rules_text: season.rules_text || "",
    registration_deadline: season.registration_deadline || "",
    visibility: season.visibility || "off",
    status: season.status || "draft",
    blocked_periods: (season.blocked_periods || []).map((period) => ({ ...period })),
    scoring_rules: rules,
  };
}

/** Die Reihenfolge der Modi je Map: alle frei (leer) oder für jede Position ein Modus. */
export function modeOrderProblem(order, bestOf) {
  const filled = (order || []).slice(0, Number(bestOf) || 0).filter(Boolean);
  if (!filled.length) return "";
  return filled.length === Number(bestOf) ? "" : "Bitte für jede Map einen Modus wählen – oder alle frei lassen.";
}

/** Das Formular als Anfrage. ``season`` ist der gespeicherte Stand: die übrigen Punkte-Regeln bleiben, wie sie sind. */
export function seasonPayload(form) {
  const order = (form.game_mode_order || []).slice(0, Number(form.best_of) || 0);
  return {
    name: form.name.trim() || null,
    start_date: form.start_day ? fromViennaInput(`${form.start_day}T00:00`) : null,
    weeks_total: number(form.weeks_total),
    matchday_days: number(form.matchday_days),
    default_match_weekday: number(form.default_match_weekday),
    default_match_time: form.default_match_time,
    round_robin_legs: number(form.round_robin_legs),
    max_staffel_size: number(form.max_staffel_size),
    best_of: number(form.best_of),
    team_size: number(form.team_size),
    min_squad_size: number(form.min_squad_size),
    scoring_rules: {
      ...(form.scoring_rules || {}),
      match_points: { win: number(form.points_win) ?? 0, draw: number(form.points_draw) ?? 0, loss: number(form.points_loss) ?? 0 },
      table_tiebreakers: form.table_tiebreakers,
    },
    game_mode_order: order.every(Boolean) ? order : [],
    result_confirm_hours: number(form.result_confirm_hours),
    lineup_amend_hours: number(form.lineup_amend_hours),
    rules_text: form.rules_text.trim() || null,
    registration_deadline: form.registration_deadline || null,
    visibility: form.visibility,
    status: form.status,
    blocked_periods: (form.blocked_periods || []).filter((period) => period.start_date && period.end_date)
      .map((period) => ({ start_date: period.start_date, end_date: period.end_date, label: (period.label || "").trim() })),
  };
}

/** Welche Werte eine Liga N anders hat als ihre Season - nur geänderte Felder, leer heißt „wie die Season“. */
export function overridesPayload(form) {
  const out = {};
  for (const key of ["best_of", "team_size", "min_squad_size", "max_staffel_size"]) {
    if (form[key] !== "" && form[key] != null) out[key] = Number(form[key]);
  }
  if (form.points_win !== "" || form.points_draw !== "" || form.points_loss !== "") {
    out.scoring_rules = { match_points: { win: number(form.points_win) ?? 3, draw: number(form.points_draw) ?? 1, loss: number(form.points_loss) ?? 0 } };
  }
  return out;
}

export function overridesToForm(overrides = {}) {
  const points = overrides.scoring_rules?.match_points;
  return {
    best_of: overrides.best_of != null ? String(overrides.best_of) : "",
    team_size: overrides.team_size != null ? String(overrides.team_size) : "",
    min_squad_size: overrides.min_squad_size != null ? String(overrides.min_squad_size) : "",
    max_staffel_size: overrides.max_staffel_size != null ? String(overrides.max_staffel_size) : "",
    points_win: points ? String(points.win) : "",
    points_draw: points ? String(points.draw) : "",
    points_loss: points ? String(points.loss) : "",
  };
}

/** Kurztext der geltenden Vorgaben einer Liga N: „Best of 3 · 4 gegen 4 · bis 8 Teams“. */
export function settingsLine(settings = {}) {
  const parts = [];
  if (settings.best_of) parts.push(`Best of ${settings.best_of}`);
  if (settings.team_size) parts.push(`${settings.team_size} gegen ${settings.team_size}`);
  if (settings.max_staffel_size) parts.push(`bis ${settings.max_staffel_size} Teams je Staffel`);
  const points = settings.scoring_rules?.match_points;
  if (points) parts.push(`Punkte ${points.win}/${points.draw}/${points.loss}`);
  return parts.join(" · ");
}

/** Ergebnis von „Vorgaben auf Staffeln übertragen“ je Staffel als Satz. */
export function syncSummary(row) {
  const applied = (row.applied || []).map((group) => SYNC_GROUP_TEXT[group]).filter(Boolean);
  const changed = (row.changed || []).length;
  const head = changed ? `${changed} ${changed === 1 ? "Wert" : "Werte"} übernommen` : "Schon aktuell";
  return { head, applied, skipped: (row.skipped || []).map((item) => `${item.label}: ${item.reason}`) };
}
