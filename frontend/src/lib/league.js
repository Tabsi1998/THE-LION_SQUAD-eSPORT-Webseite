// Liga verwalten (docs/LIGA.md, #1622): Formularwerte einer Season ↔ Anfrage an /api/admin/leagues. Die Regeln prüft der
// Server noch einmal (services/league_service.py); hier steht nur, was die Oberfläche selbst wissen muss.
import { fromViennaInput, viennaDay } from "@/lib/vienna";
import { applicationPayload, applicationToForm } from "@/lib/leagueApplications";
import { prizesPayload, prizesToForm } from "@/lib/leagueLook";
import { tableRulesPayload, tableRulesToForm } from "@/lib/leagueTable";

export const VISIBILITY_OPTIONS = [
  ["off", "Aus – niemand sieht die Liga"],
  ["admins", "Nur Liga-Leitung"],
  ["members", "Nur Mitglieder"],
  ["public", "Öffentlich"],
];
export const VISIBILITY_SHORT = { off: "Aus", admins: "Nur Liga-Leitung", members: "Nur Mitglieder", public: "Öffentlich" };
export const SEASON_STATUS_OPTIONS = [["draft", "Entwurf"], ["active", "Läuft"], ["completed", "Beendet"], ["archived", "Archiviert"]];
export const WEEKDAY_OPTIONS = [["0", "Montag"], ["1", "Dienstag"], ["2", "Mittwoch"], ["3", "Donnerstag"], ["4", "Freitag"], ["5", "Samstag"], ["6", "Sonntag"]];
export const BEST_OF_OPTIONS = [["1", "Best of 1"], ["3", "Best of 3"], ["5", "Best of 5"], ["7", "Best of 7"]];
export const LEGS_OPTIONS = [["1", "Nur Hinrunde"], ["2", "Hin- und Rückrunde"]];
// Map-Wiederholung in einer Serie (#2096): Vorgabe „gleiche Map nur in anderem Modus“.
export const MAP_REPEAT_OPTIONS = [["other_mode", "Gleiche Map nur in anderem Modus"], ["never", "Aus – jede Map nur einmal"], ["always", "Immer erlaubt"]];
// Stand einer Liga und einer Liga N (#2106): archiviert heißt ausgeblendet, aber erhalten.
export const ACTIVE_STATUS_OPTIONS = [["active", "Aktiv"], ["archived", "Archiviert"]];
export const SYNC_GROUP_TEXT = {
  always: "Sichtbarkeit und Regeltext",
  running: "Antwortfrist auf Terminvorschläge",
  // Wie SYNC_GROUP_LABELS im Server (league_service.py): Terminregeln (#2194), Ergebnisregeln (#1617), Sperrliste (#2218).
  schedule: "Terminregeln",
  result_rules: "Ergebnisregeln und Punktepflicht",
  before_start: "Termine und Kalender",
  before_result: "Best of, Teamgröße, Mindestkader, Punkte und Fristen",
  map_pool: "Map-Pool",
  loadout_bans: "Sperrliste",
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
    // Spielberechtigung (#2204): Fehlt ein Wert (ältere Season), bleibt das Feld leer und die Season, wie sie ist.
    max_squad_size: season.max_squad_size != null ? String(season.max_squad_size) : "",
    had_rules: season.lineup_mode != null,
    one_team_per_season: Boolean(season.one_team_per_season),
    new_player_wait_days: season.new_player_wait_days != null ? String(season.new_player_wait_days) : "",
    min_age: season.min_age != null ? String(season.min_age) : "",
    unique_game_ids: Boolean(season.unique_game_ids),
    lineup_mode: season.lineup_mode || "per_map",
    lineup_min_players: season.lineup_min_players != null ? String(season.lineup_min_players) : "",
    transfer_windows: (season.transfer_windows || []).map((window) => ({ ...window })),
    // Selbstanmeldung (#2205): Ohne Fenster gibt es sie nicht.
    ...applicationToForm(season),
    points_win: String(points.win ?? 3),
    points_draw: String(points.draw ?? 1),
    points_loss: String(points.loss ?? 0),
    // Tabelle (E.1, #1625): Gleichstand, Mini-Tabelle, Remis, Default-Win, Ausscheiden.
    ...tableRulesToForm(rules),
    game_mode_order: season.game_mode_order || [],
    map_repeat: season.map_repeat || "other_mode",
    result_confirm_hours: String(season.result_confirm_hours ?? 48),
    lineup_amend_hours: String(season.lineup_amend_hours ?? 48),
    // Antwortfrist (#2106, F3): leer bei Seasons von vorher - dann behält jede Staffel ihre eigene.
    match_schedule_response_hours: season.match_schedule_response_hours != null ? String(season.match_schedule_response_hours) : "",
    rules_text: season.rules_text || "",
    registration_deadline: season.registration_deadline || "",
    visibility: season.visibility || "off",
    status: season.status || "draft",
    blocked_periods: (season.blocked_periods || []).map((period) => ({ ...period })),
    scoring_rules: rules,
    // Gestaltung (#2107): leer heißt „wie die Liga“; Gewinne der Season.
    emblem_url: season.emblem_url || "",
    banner_url: season.banner_url || "",
    banner_focus: season.banner_focus || null,
    prizes: prizesToForm(season.prizes),
  };
}

/** Die Reihenfolge der Modi je Map: alle frei (leer) oder für jede Position ein Modus. */
export function modeOrderProblem(order, bestOf) {
  const filled = (order || []).slice(0, Number(bestOf) || 0).filter(Boolean);
  if (!filled.length) return "";
  return filled.length === Number(bestOf) ? "" : "Bitte für jede Map einen Modus wählen – oder alle frei lassen.";
}

/** Die längste Serie der Season (#2207): Best of der Season oder einer aktiven Liga N mit eigenem Best of. So lang ist „Modus je Map“. */
export function longestSeries(bestOf, divisions = []) {
  const own = (divisions || []).filter((row) => (row.status || "active") === "active").map((row) => Number(row.overrides?.best_of) || 0);
  return Math.max(Number(bestOf) || 1, ...own);
}

/** Gleiche Reihenfolge wie gespeichert? Fehlt eine, ist sie leer. */
export function sameOrder(a, b) {
  const left = a || [];
  const right = b || [];
  return left.length === right.length && left.every((mode, index) => mode === right[index]);
}

/** Hinweis, wenn eine gesetzte Reihenfolge nicht so lang ist wie die längste Serie (#2207) - Altbestand in laufenden Seasons. */
export function orderLengthNote(order, maps) {
  const filled = (order || []).filter(Boolean);
  const count = Number(maps) || 0;
  if (!filled.length || (order || []).length === count) return "";
  return `Gespeichert sind ${(order || []).length} ${(order || []).length === 1 ? "Eintrag" : "Einträge"}, die längste Serie hat ${count} Maps (Best of ${count}). `
    + "In einer laufenden Season gilt die Reihenfolge weiter (zyklisch) - ändern heißt: für jede Map einen Modus wählen.";
}

/** Das Formular als Anfrage. ``season`` ist der gespeicherte Stand: die übrigen Punkte-Regeln bleiben, wie sie sind. ``maps``: Länge von
 * „Modus je Map“, Vorgabe das Best of der Season. ``savedOrder``: die gespeicherte Reihenfolge - ist sie unverändert, geht sie genau so
 * mit, auch wenn sie nicht zur Serie passt (#2207: Altbestand laufender Seasons, der Server warnt nur). */
export function seasonPayload(form, maps = form.best_of, savedOrder = undefined) {
  const kept = savedOrder !== undefined && sameOrder(form.game_mode_order, savedOrder);
  const order = kept ? [...(savedOrder || [])] : (form.game_mode_order || []).slice(0, Number(maps) || 0);
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
    max_squad_size: number(form.max_squad_size),
    // Eine ältere Season bleibt, wie sie ist (#2204): Was niemand angefasst hat, geht gar nicht erst mit.
    ...(form.had_rules || form.one_team_per_season ? { one_team_per_season: Boolean(form.one_team_per_season) } : {}),
    new_player_wait_days: number(form.new_player_wait_days),
    min_age: number(form.min_age),
    ...(form.had_rules || form.unique_game_ids ? { unique_game_ids: Boolean(form.unique_game_ids) } : {}),
    ...(form.had_rules || (form.lineup_mode && form.lineup_mode !== "per_map") ? { lineup_mode: form.lineup_mode || "per_map" } : {}),
    lineup_min_players: number(form.lineup_min_players),
    transfer_windows: (form.transfer_windows || []).filter((window) => window.start_date && window.end_date),
    ...applicationPayload(form),
    scoring_rules: {
      ...(form.scoring_rules || {}),
      match_points: { win: number(form.points_win) ?? 0, draw: number(form.points_draw) ?? 0, loss: number(form.points_loss) ?? 0 },
      ...tableRulesPayload(form),
    },
    game_mode_order: order.every(Boolean) ? order : [],
    map_repeat: form.map_repeat || "other_mode",
    result_confirm_hours: number(form.result_confirm_hours),
    lineup_amend_hours: number(form.lineup_amend_hours),
    match_schedule_response_hours: number(form.match_schedule_response_hours),
    rules_text: form.rules_text.trim() || null,
    registration_deadline: form.registration_deadline || null,
    visibility: form.visibility,
    status: form.status,
    blocked_periods: (form.blocked_periods || []).filter((period) => period.start_date && period.end_date)
      .map((period) => ({ start_date: period.start_date, end_date: period.end_date, label: (period.label || "").trim() })),
    emblem_url: form.emblem_url || null,
    banner_url: form.banner_url || null,
    banner_focus: form.banner_url ? form.banner_focus || null : null,
    prizes: prizesPayload(form.prizes),
  };
}

// Gestaltung (#2107): Emblem, Banner mit Fokuspunkt, Akzentfarbe. Leer heißt entfernen (``null`` an den Server).
const LOOK_KEYS = ["emblem_url", "banner_url", "banner_focus", "accent_color"];

/** Die Gestaltung einer Liga als Formular - Bilder und Farbe als Text, der Fokuspunkt als Objekt oder null. */
export function leagueLookToForm(league) {
  return {
    emblem_url: league?.emblem_url || "",
    banner_url: league?.banner_url || "",
    banner_focus: league?.banner_focus || null,
    accent_color: league?.accent_color || "",
  };
}

/** Nur die geänderten Gestaltungs-Felder als Anfrage (beim Anlegen: ``saved = {}``, also nur die gesetzten). */
export function leagueLookChanges(form, saved = {}) {
  const out = {};
  const value = (key) => {
    if (key === "banner_focus") return form.banner_url ? form.banner_focus || null : null;
    return String(form[key] || "").trim() || null;
  };
  for (const key of LOOK_KEYS) {
    const next = value(key);
    const before = saved?.[key] ?? null;
    if (JSON.stringify(next) !== JSON.stringify(before)) out[key] = next;
  }
  return out;
}

/** Welche Werte eine Liga N anders hat als ihre Season - nur geänderte Felder, leer heißt „wie die Season“. */
export function overridesPayload(form) {
  const out = {};
  for (const key of ["best_of", "team_size", "min_squad_size", "max_staffel_size", "match_schedule_response_hours"]) {
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
    match_schedule_response_hours: overrides.match_schedule_response_hours != null ? String(overrides.match_schedule_response_hours) : "",
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

/** Was beim Löschen mitginge (#2106) - je Gruppe die Namen, leere Gruppen fallen weg. ``plan`` kommt von
 *  `GET …/delete-plan`. */
export function deletionGroups(plan) {
  if (!plan) return [];
  const groups = [
    ["Seasons", (plan.seasons || []).map((row) => row.name)],
    ["Ligen", (plan.divisions || []).map((row) => row.label)],
    ["Leere Staffeln (Entwurf)", (plan.staffeln || []).map((row) => row.title || `Staffel ${row.staffel}`)],
  ];
  return groups.filter(([, items]) => items.length).map(([label, items]) => ({ label, items }));
}

/** Ergebnis von „Vorgaben auf Staffeln übertragen“ je Staffel als Satz. */
export function syncSummary(row) {
  const applied = (row.applied || []).map((group) => SYNC_GROUP_TEXT[group]).filter(Boolean);
  const changed = (row.changed || []).length;
  const head = changed ? `${changed} ${changed === 1 ? "Wert" : "Werte"} übernommen` : "Schon aktuell";
  return { head, applied, skipped: (row.skipped || []).map((item) => `${item.label}: ${item.reason}`) };
}
