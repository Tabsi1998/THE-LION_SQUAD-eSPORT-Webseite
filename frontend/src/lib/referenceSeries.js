// Externe Serien (#1741): Spur (Klammer, etwa eine Rennliga) mit je einer Serie pro Saison und Stufe. Die Regeln kommen
// vollständig vom Server (Vorlage oder Standard, `default_rules`) und gehen vollständig zurück - hier wird nichts gerechnet,
// nur zwischen Formularfeldern und Werten gewandelt. Gerechnet wird im Server (services/scoring_rules.py).

export const KIND_OPTIONS = [["series", "Turnierserie"], ["racing", "Rennliga"], ["team_league", "Team-Liga"]];
export const STATUS_OPTIONS = [["planned", "Geplant"], ["active", "Läuft"], ["completed", "Abgeschlossen"]];
export const STATUS_LABELS = { ...Object.fromEntries(STATUS_OPTIONS), archived: "Archiviert" };
export const PUBLISH_OPTIONS = [["review", "Entwurf, der Vorstand gibt frei"], ["direct", "Captain veröffentlicht direkt"]];
export const VISIBILITY_OPTIONS = [["public", "Öffentlich"], ["community", "Community"], ["members", "Vereinsmitglieder"], ["internal", "Intern"]];
export const WEEKDAY_OPTIONS = [["", "—"], ["0", "Montag"], ["1", "Dienstag"], ["2", "Mittwoch"], ["3", "Donnerstag"], ["4", "Freitag"], ["5", "Samstag"], ["6", "Sonntag"]];
export const POINTS_MODE_OPTIONS = [["scheme", "Punkte je Platz"], ["organizer", "Punkte laut Veranstalter"]];
export const COUNT_MODE_OPTIONS = [["all", "Alle Runden zählen"], ["best_n", "Beste N Ergebnisse"], ["drop_n", "N Streichergebnisse"]];
export const TIEBREAKER_OPTIONS = [
  ["", "—"],
  ["countback", "Mehr Siege, dann mehr zweite Plätze …"],
  ["wins", "Mehr Siege"],
  ["podiums", "Mehr Podestplätze"],
  ["best_place", "Bester Einzelplatz"],
  ["latest_result", "Besseres letztes Ergebnis"],
];
export const TABLE_TIEBREAKER_OPTIONS = [["", "—"], ["score_diff", "Differenz"], ["score_for", "Erzielte Punkte"], ["wins", "Siege"]];

const text = (value) => (value === null || value === undefined ? "" : String(value));
const number = (value, fallback = 0) => {
  const parsed = Number(String(value ?? "").trim().replace(",", "."));
  return String(value ?? "").trim() === "" || Number.isNaN(parsed) ? fallback : parsed;
};
const optional = (value) => (String(value ?? "").trim() === "" ? null : number(value, null));
const pad = (list, length) => [...list, ...Array(Math.max(0, length - list.length)).fill("")].slice(0, length);

/** „25, 18, 15“, „35-30-26“ oder je Zeile eine Zahl - Dezimalpunkt erlaubt. */
export function parsePointsList(value) {
  return String(value || "").split(/[^0-9.]+/).filter(Boolean).map(Number).filter((item) => !Number.isNaN(item));
}

export function rulesToForm(rules = {}) {
  const bonuses = rules.bonuses || {};
  const team = rules.team_scoring || {};
  const match = rules.match_points || {};
  return {
    points_mode: rules.points_mode || "scheme",
    points_by_place: (rules.points_by_place || []).join(", "),
    fastest_lap_points: text(bonuses.fastest_lap?.points ?? 0),
    fastest_lap_max_place: text(bonuses.fastest_lap?.max_place),
    pole_points: text(bonuses.pole?.points ?? 0),
    pole_max_place: text(bonuses.pole?.max_place),
    dnf_points: text(rules.dnf_points),
    dns_points: text(rules.dns_points ?? 0),
    dsq_points: text(rules.dsq_points ?? 0),
    count_mode: rules.count_mode || "all",
    count_n: text(rules.count_n ?? 0),
    activity_points: text(rules.activity_points?.points ?? 0),
    activity_from_round: text(rules.activity_points?.from_round ?? 1),
    final_top_n: text(rules.final_top_n),
    tiebreakers: pad(rules.tiebreakers || [], 3),
    team_enabled: Boolean(team.enabled),
    team_counting_drivers: text(team.counting_drivers),
    team_guests_count: team.guests_count !== false,
    match_win: text(match.win ?? 3),
    match_draw: text(match.draw ?? 1),
    match_loss: text(match.loss ?? 0),
    table_tiebreakers: pad(rules.table_tiebreakers || [], 3),
  };
}

export function formToRules(form) {
  return {
    points_mode: form.points_mode,
    points_by_place: parsePointsList(form.points_by_place),
    bonuses: {
      fastest_lap: { points: number(form.fastest_lap_points), max_place: optional(form.fastest_lap_max_place) },
      pole: { points: number(form.pole_points), max_place: optional(form.pole_max_place) },
    },
    // Leer heißt beim Ausfall: Punkte nach Platz.
    dnf_points: optional(form.dnf_points),
    dns_points: number(form.dns_points),
    dsq_points: number(form.dsq_points),
    count_mode: form.count_mode,
    count_n: number(form.count_n),
    activity_points: { points: number(form.activity_points), from_round: number(form.activity_from_round, 1) },
    final_top_n: optional(form.final_top_n),
    tiebreakers: (form.tiebreakers || []).filter(Boolean),
    team_scoring: { enabled: Boolean(form.team_enabled), counting_drivers: optional(form.team_counting_drivers), guests_count: Boolean(form.team_guests_count) },
    match_points: { win: number(form.match_win), draw: number(form.match_draw), loss: number(form.match_loss) },
    table_tiebreakers: (form.table_tiebreakers || []).filter(Boolean),
  };
}

export const emptyLineage = {
  title: "", kind: "racing", label: "", organizer: "", game_id: "", partner_ids: [], external_url: "", description: "",
  visibility: "public", slug: "", order_index: 0,
};

export function lineageToForm(lineage = {}) {
  const form = { ...emptyLineage };
  for (const key of Object.keys(emptyLineage)) {
    if (lineage[key] !== null && lineage[key] !== undefined) form[key] = lineage[key];
  }
  return form;
}

export function lineagePayload(form) {
  const blank = (value) => (String(value ?? "").trim() === "" ? null : String(value).trim());
  return {
    title: String(form.title || "").trim(), kind: form.kind, label: blank(form.label), organizer: blank(form.organizer),
    game_id: blank(form.game_id), partner_ids: form.partner_ids || [], external_url: blank(form.external_url),
    description: blank(form.description), visibility: form.visibility, order_index: Number(form.order_index) || 0,
    ...(String(form.slug || "").trim() ? { slug: String(form.slug).trim() } : {}),
  };
}

export function seriesToForm(series = {}, rules = series.rules) {
  return {
    lineage_id: series.lineage_id || "",
    points_scheme_id: series.points_scheme_id || "",
    season: series.season || "",
    tier: series.tier || "",
    title: series.title || "",
    status: series.status && series.status !== "archived" ? series.status : "planned",
    publish_mode: series.publish_mode || "review",
    default_weekday: series.default_weekday === null || series.default_weekday === undefined ? "" : String(series.default_weekday),
    default_time: series.default_time || "",
    team_name: series.team_name || "",
    official_table_url: series.official_table_url || "",
    external_url: series.external_url || "",
    visibility: series.visibility || "public",
    description: series.description || "",
    rules_note: "",
    rules: rulesToForm(rules || {}),
  };
}

export function seriesPayload(form, { isNew = false, archived = false } = {}) {
  const blank = (value) => (String(value ?? "").trim() === "" ? null : String(value).trim());
  const payload = {
    season: String(form.season || "").trim(),
    tier: blank(form.tier),
    title: blank(form.title),
    publish_mode: form.publish_mode,
    default_weekday: form.default_weekday === "" || form.default_weekday === null || form.default_weekday === undefined ? null : Number(form.default_weekday),
    default_time: blank(form.default_time),
    team_name: blank(form.team_name),
    official_table_url: blank(form.official_table_url),
    external_url: blank(form.external_url),
    visibility: form.visibility,
    description: blank(form.description),
    rules: formToRules(form.rules),
  };
  // Eine archivierte Serie behält beim Bearbeiten ihren Stand; zurück holt sie „Zurückholen“.
  if (!archived) payload.status = form.status;
  if (isNew) {
    payload.lineage_id = form.lineage_id;
    payload.points_scheme_id = blank(form.points_scheme_id);
  } else if (String(form.rules_note || "").trim()) {
    payload.rules_note = String(form.rules_note).trim();
  }
  return payload;
}

/** Öffentliche Adresse einer Serie (Entscheidung 5). Die Seite selbst kommt mit #1745. */
export function seriesAddress(lineage, series) {
  return `/references/series/${lineage?.slug || ""}/${series?.season_slug || ""}`;
}

/** Spuren mit ihren Serien - Archiviertes nur auf Wunsch. */
export function visibleLineages(lineages, showArchived) {
  return (lineages || [])
    .filter((lineage) => showArchived || !lineage.is_archived)
    .map((lineage) => ({ ...lineage, series: (lineage.series || []).filter((series) => showArchived || series.status !== "archived") }));
}
