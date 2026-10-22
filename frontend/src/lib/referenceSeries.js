// Externe Serien (#1741): Spur (Klammer, etwa eine Rennliga) mit je einer Serie pro Saison und Stufe. Die Regeln kommen
// vollständig vom Server (Vorlage oder Standard, `default_rules`) und gehen vollständig zurück - hier wird nichts gerechnet,
// nur zwischen Formularfeldern und Werten gewandelt. Gerechnet wird im Server (services/scoring_rules.py).

export const KIND_OPTIONS = [["series", "Turnierserie"], ["racing", "Rennliga"], ["team_league", "Team-Liga"]];
// #1960: „Abgebrochen“ - Ergebnisse bleiben sichtbar, ohne Meister und ohne Platzierung.
export const STATUS_OPTIONS = [["planned", "Geplant"], ["active", "Läuft"], ["completed", "Abgeschlossen"], ["cancelled", "Abgebrochen"]];
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
  ["top_n", "Mehr Plätze unter den besten N"],
  ["podiums", "Mehr Podestplätze"],
  ["best_place", "Bester Einzelplatz"],
  ["latest_result", "Besseres letztes Ergebnis"],
];
export const TABLE_TIEBREAKER_OPTIONS = [["", "—"], ["score_diff", "Differenz"], ["score_for", "Erzielte Punkte"], ["wins", "Siege"]];
// Vorlagen für Ergebnis-Bilder (#1756) - dieselben Kennungen wie backend/services/result_image_templates.py. Ohne Wahl
// gilt die Standard-Vorlage der Art, „none“ schaltet das Auslesen ab.
export const RESULT_IMAGE_TEMPLATES = [{ id: "rennliga-dunkel", name: "Rennliga-Ergebnis (dunkel)", kinds: ["racing"] }];

/** Auswahl der Vorlage für Ergebnis-Bilder. Spur: „Standard der Art“; Saison (`inherit`): „wie bei der Spur“. Leer,
 *  wenn für die Art keine Vorlage passt und nichts gewählt ist - dann zeigt das Formular das Feld nicht. */
export function resultImageOptions(kind, { inherit = false, value = "" } = {}) {
  const fitting = RESULT_IMAGE_TEMPLATES.filter((item) => item.kinds.includes(kind));
  if (!fitting.length && !value) return [];
  const fallback = inherit ? "Wie bei der Spur" : fitting.length ? `Standard: ${fitting[0].name}` : "Keine Vorlage";
  return [["", fallback], ...RESULT_IMAGE_TEMPLATES.map((item) => [item.id, item.name]), ["none", "Aus – kein Auslesen"]];
}

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

let bonusCounter = 0;

/** Ein Sonderbonus der Saison im Formular (#1961): Name und Punkte; die Kennung bleibt beim Umbenennen. */
export function emptyBonus(values = {}) {
  bonusCounter += 1;
  return { key: "", label: "", points: "", formKey: `bonus-${bonusCounter}`, ...values };
}

export function rulesToForm(rules = {}) {
  const bonuses = rules.bonuses || {};
  const team = rules.team_scoring || {};
  const match = rules.match_points || {};
  const day = rules.day_rounds || {};
  return {
    // Turniertage (#1961): Runden je Termin, Rundenpunkte, Sonderboni und das N der Regel „Top N“.
    day_rounds_count: text(day.count || ""),
    day_rounds_points: (day.points_by_place || [8, 7, 6, 5, 4, 3, 2, 1]).join(", "),
    custom_bonuses: (rules.custom_bonuses || []).map((bonus) => emptyBonus({ key: bonus.key, label: bonus.label, points: text(bonus.points) })),
    tiebreak_top_n: text(rules.tiebreak_top_n ?? 4),
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
    // #1960: Teamwertung je Rennen (Vorgabe) oder nach aktueller Besetzung; Mindestzahl am Start je Termin.
    team_mode: team.mode || "per_race",
    // Einträge „kein Team“ (Ersatzfahrer) als Text, je Name durch Komma getrennt; ohne Angabe die Vorgabe des Servers.
    team_no_team_names: Array.isArray(team.no_team_names) ? team.no_team_names.join(", ") : "Ersatzfahrer",
    // #2000: Vorgabe des Hakens „zählt auch für die Teamwertung“ neuer Fahrer-Anpassungen.
    team_adjustments_count: Boolean(team.adjustments_count_for_team),
    min_participants: text(rules.min_participants),
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
    team_scoring: {
      enabled: Boolean(form.team_enabled), counting_drivers: optional(form.team_counting_drivers), guests_count: Boolean(form.team_guests_count),
      mode: form.team_mode || "per_race",
      no_team_names: String(form.team_no_team_names ?? "Ersatzfahrer").split(/[,;\n]/).map((name) => name.trim()).filter(Boolean),
      adjustments_count_for_team: Boolean(form.team_adjustments_count),
    },
    min_participants: optional(form.min_participants),
    match_points: { win: number(form.match_win), draw: number(form.match_draw), loss: number(form.match_loss) },
    table_tiebreakers: (form.table_tiebreakers || []).filter(Boolean),
    day_rounds: { count: number(form.day_rounds_count), points_by_place: parsePointsList(form.day_rounds_points) },
    custom_bonuses: (form.custom_bonuses || [])
      .filter((bonus) => String(bonus.label || "").trim())
      .map((bonus) => ({ ...(bonus.key ? { key: bonus.key } : {}), label: String(bonus.label).trim(), points: number(bonus.points) })),
    tiebreak_top_n: number(form.tiebreak_top_n, 4),
  };
}

export const emptyLineage = {
  title: "", kind: "racing", label: "", organizer: "", game_id: "", partner_ids: [], partner_roles: {}, external_url: "", description: "",
  visibility: "public", slug: "", order_index: 0,
  // #1898: eigene Reihenfolge der Stufen (höchste zuerst); null heißt Vorgabe aus der Zahl im Namen.
  tier_order: null,
  // #1756: Vorlage für Ergebnis-Bilder; leer heißt Standard der Art.
  result_image_template: "",
  // #2014: Logo der Spur, nur aus dem Upload bzw. der Mediathek; leer heißt Spiel-Logo bzw. Partner-Abzeichen.
  logo_url: "",
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
    game_id: blank(form.game_id), partner_ids: form.partner_ids || [], partner_roles: form.partner_roles || {},
    external_url: blank(form.external_url),
    description: blank(form.description), visibility: form.visibility, order_index: Number(form.order_index) || 0,
    tier_order: Array.isArray(form.tier_order) && form.tier_order.length ? form.tier_order : null,
    result_image_template: blank(form.result_image_template),
    logo_url: blank(form.logo_url),
    ...(String(form.slug || "").trim() ? { slug: String(form.slug).trim() } : {}),
  };
}

// ---------------------------------------------------------------- Eigene Teams (#1926)
let teamCounter = 0;

/** Eine Zeile „Eigenes Team“ im Formular: Name und weitere Schreibweisen als Text (Komma, Strichpunkt oder Zeile). */
export function emptyOwnTeam(values = {}) {
  teamCounter += 1;
  return { key: `team-${teamCounter}`, name: "", aliases: "", ...values };
}

function ownTeamsToForm(series) {
  const teams = Array.isArray(series.own_teams) && series.own_teams.length
    ? series.own_teams
    : [{ name: series.team_name || "", aliases: [] }];
  return teams.map((team) => emptyOwnTeam({ name: team.name || "", aliases: (team.aliases || []).join(", ") }));
}

function ownTeamsPayload(teams) {
  return (teams || [])
    .map((team) => ({
      name: String(team.name || "").trim(),
      aliases: String(team.aliases || "").split(/[,;\n]/).map((alias) => alias.trim()).filter(Boolean),
    }))
    .filter((team) => team.name);
}

export function seriesToForm(series = {}, rules = series.rules) {
  return {
    own_teams: ownTeamsToForm(series),
    lineage_id: series.lineage_id || "",
    points_scheme_id: series.points_scheme_id || "",
    season: series.season || "",
    tier: series.tier || "",
    title: series.title || "",
    status: series.status && series.status !== "archived" ? series.status : "planned",
    publish_mode: series.publish_mode || "review",
    default_weekday: series.default_weekday === null || series.default_weekday === undefined ? "" : String(series.default_weekday),
    default_time: series.default_time || "",
    official_table_url: series.official_table_url || "",
    external_url: series.external_url || "",
    visibility: series.visibility || "public",
    description: series.description || "",
    season_result: series.season_result || "",
    result_image_template: series.result_image_template || "",
    // #2014: eigenes Saison-Logo; leer heißt: das Logo der Spur.
    logo_url: series.logo_url || "",
    // #1934: eigene Partner der Saison – die der Spur erbt sie ohnehin.
    partner_ids: Array.isArray(series.partner_ids) ? series.partner_ids : [],
    partner_roles: series.partner_roles || {},
    // #1961: Namen öffentlich ohne Tag der Spielkennung („Name#TLS“ → „Name“).
    hide_name_tags: Boolean(series.hide_name_tags),
    // #1960: Saison abgebrochen (Tag, Grund) und Nachfolger.
    cancelled_on: series.cancelled_on || "",
    cancel_reason: series.cancel_reason || "",
    successor_id: series.successor_id || "",
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
    // #1926: alle eigenen Teams - das erste gilt beim Server auch als „Eigenes Team“ (team_name) älterer Leser.
    own_teams: ownTeamsPayload(form.own_teams),
    official_table_url: blank(form.official_table_url),
    external_url: blank(form.external_url),
    visibility: form.visibility,
    description: blank(form.description),
    // #1898: Ergebnis der Saison - leer heißt: der Liga-Weg leitet es aus den Stufen ab.
    season_result: form.season_result || null,
    // #1756: leer heißt „wie bei der Spur“.
    result_image_template: form.result_image_template || null,
    logo_url: blank(form.logo_url),
    partner_ids: form.partner_ids || [],
    partner_roles: form.partner_roles || {},
    hide_name_tags: Boolean(form.hide_name_tags),
    rules: formToRules(form.rules),
  };
  // Eine archivierte Serie behält beim Bearbeiten ihren Stand; zurück holt sie „Zurückholen“.
  if (!archived) payload.status = form.status;
  if (isNew) {
    payload.lineage_id = form.lineage_id;
    payload.points_scheme_id = blank(form.points_scheme_id);
    return payload;
  }
  if (String(form.rules_note || "").trim()) payload.rules_note = String(form.rules_note).trim();
  // #1960: Nachfolger (etwa der Neustart); abgebrochen mit Tag (leer heißt heute) und Grund - nur mit diesem Status.
  payload.successor_id = form.successor_id || null;
  if (!archived && form.status === "cancelled") {
    payload.cancelled_on = form.cancelled_on || null;
    payload.cancel_reason = blank(form.cancel_reason);
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
