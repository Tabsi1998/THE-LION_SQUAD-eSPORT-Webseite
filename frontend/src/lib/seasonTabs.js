// Season-Seite mit Reitern (#2267, docs/LIGA.md „Season-Seite“): welcher Reiter welche Felder trägt, Adresse ↔ Reiter, Speichern je
// Reiter, Ablaufleiste und die Hinweise des Überblicks. Jede Angabe steht an genau einer Stelle (#2023) - der Test prüft, dass jedes
// Formularfeld und jedes Feld der Anfrage genau einem Reiter gehört. Daten und API bleiben, wie sie sind: Jeder Reiter schickt nur
// seine Felder an PATCH /api/admin/leagues/seasons/{id}, der Server nimmt Teil-Anfragen an.
import { seasonPayload } from "@/lib/league";
import { dayNoon, viennaDate, viennaDateTime, viennaDay } from "@/lib/vienna";

export const SEASON_TABS = [
  { key: "ueberblick", label: "Überblick" },
  { key: "spielbetrieb", label: "Spielbetrieb" },
  { key: "termine", label: "Termine" },
  { key: "anmeldung", label: "Anmeldung und Kader" },
  { key: "tabelle", label: "Tabelle" },
  { key: "regelwerk", label: "Regelwerk und Sperrliste" },
  { key: "ligen", label: "Ligen und Staffeln" },
];

// Abschnitte innerhalb der Reiter, per Sprungmarke erreichbar (Prüfung, Nachrichten des Servers, Handbuch). „anmeldungen“ ist die
// Marke, die der Server schon vor #2267 in seine Nachrichten schreibt - sie bleibt gültig.
export const SEASON_SECTIONS = {
  pruefung: "ueberblick",
  gestaltung: "ueberblick",
  modi: "spielbetrieb",
  mindestgroesse: "spielbetrieb",
  ergebnisregeln: "spielbetrieb",
  serie: "spielbetrieb",
  veto: "spielbetrieb",
  kalender: "termine",
  terminregeln: "termine",
  checkin: "termine",
  selbstanmeldung: "anmeldung",
  spielberechtigung: "anmeldung",
  plattform: "anmeldung",
  anmeldungen: "anmeldung",
  kader: "anmeldung",
  punkte: "tabelle",
  gleichstand: "tabelle",
  sperrliste: "regelwerk",
  staffeln: "ligen",
  uebertragen: "ligen",
};

/** Reiter und Abschnitt aus der Sprungmarke: `#termine` → Reiter, `#kader` → Reiter „Anmeldung und Kader“ samt Abschnitt. */
export function seasonTarget(hash) {
  const key = String(hash || "").replace(/^#/, "").trim().toLowerCase();
  if (SEASON_TABS.some((tab) => tab.key === key)) return { tab: key, section: "" };
  if (SEASON_SECTIONS[key]) return { tab: SEASON_SECTIONS[key], section: key };
  return { tab: SEASON_TABS[0].key, section: "" };
}

/** Adresse der Season-Seite, auf Wunsch mit Reiter oder Abschnitt - für Links aus Regelwerk, Turnierverwaltung und Hinweisen. */
export function seasonAnchorUrl(seasonId, anchor = "") {
  const base = `/admin/leagues/seasons/${encodeURIComponent(seasonId || "")}`;
  return anchor && anchor !== SEASON_TABS[0].key ? `${base}#${anchor}` : base;
}

// Prüfung vor der Veröffentlichung (C.2): wohin ein Punkt führt.
const READINESS_ANCHORS = {
  pool_missing: "modi", pool_stale: "modi", pool_too_small: "modi", inactive_mode: "modi", inactive_map: "modi",
  mode_order_missing: "serie", mode_order_length: "serie",
  // Veto (D.3, #1618): die Vorlage steht im Reiter Spielbetrieb, der fehlende Check-in im Reiter Termine.
  veto_invalid: "veto", veto_division_mismatch: "veto", veto_without_checkin: "checkin",
  rules_missing: "regelwerk", rules_upcoming: "regelwerk",
  application_none: "selbstanmeldung", application_after_start: "selbstanmeldung", application_closed: "selbstanmeldung",
  divisions_missing: "staffeln", staffel_missing: "staffeln",
};

export function readinessAnchor(code) {
  return READINESS_ANCHORS[code] || "";
}

/** Der Reiter, in dem ein Abschnitt oder Reiter liegt - für die Beschriftung „Zu Termine“. */
export function tabLabelOf(anchor) {
  const tab = seasonTarget(`#${anchor}`).tab;
  return SEASON_TABS.find((row) => row.key === tab)?.label || "";
}

// Welche Felder des Formulars (seasonToForm) zu welchem Reiter gehören. Die Merker `had_*` und `scoring_rules` halten nur fest, was
// gespeichert war, und reisen mit ihrem Reiter.
export const TAB_FIELDS = {
  ueberblick: ["name", "visibility", "status", "promote_on_home", "emblem_url", "banner_url", "banner_focus", "prizes"],
  spielbetrieb: ["best_of", "team_size", "game_mode_order", "map_repeat", "result_confirm_hours", "lineup_amend_hours"],
  termine: ["start_day", "weeks_total", "matchday_days", "default_match_weekday", "default_match_time", "round_robin_legs", "blocked_periods",
    "match_schedule_response_hours"],
  anmeldung: ["application_opens", "application_closes", "application_slots", "application_waitlist", "application_waitlist_limit",
    "application_waitlist_note", "application_privacy_text", "entry_policy", "sibling_squads_in_staffel", "application_auto_accept", "had_application", "registration_deadline",
    "min_squad_size", "max_squad_size", "had_rules", "one_team_per_season", "new_player_wait_days", "min_age", "unique_game_ids", "lineup_mode",
    "lineup_min_players", "transfer_windows", "platform_field", "allowed_platforms", "crossplay", "input_device"],
  tabelle: ["match_points_mode", "points_win", "points_draw", "points_loss", "table_tiebreakers", "head_to_head_criteria", "allow_draws", "forfeit_score", "exit_rule",
    "scoring_rules"],
  regelwerk: ["rules_text"],
  ligen: ["max_staffel_size"],
};

// Welche Felder der Anfrage (seasonPayload) ein Reiter schickt.
export const TAB_PAYLOAD_KEYS = {
  ueberblick: ["name", "visibility", "status", "promote_on_home", "emblem_url", "banner_url", "banner_focus", "prizes"],
  spielbetrieb: ["best_of", "team_size", "game_mode_order", "map_repeat", "result_confirm_hours", "lineup_amend_hours"],
  termine: ["start_date", "weeks_total", "matchday_days", "default_match_weekday", "default_match_time", "round_robin_legs", "blocked_periods",
    "match_schedule_response_hours"],
  anmeldung: ["application_opens_at", "application_closes_at", "application_slots", "application_waitlist", "application_waitlist_limit",
    "application_waitlist_note", "application_privacy_text", "entry_policy", "sibling_squads_in_staffel", "application_auto_accept", "registration_deadline",
    "min_squad_size", "max_squad_size", "one_team_per_season", "new_player_wait_days", "min_age", "unique_game_ids", "lineup_mode",
    "lineup_min_players", "transfer_windows", "platform_field", "allowed_platforms", "crossplay", "input_device"],
  tabelle: ["scoring_rules"],
  regelwerk: ["rules_text"],
  ligen: ["max_staffel_size"],
};

const pick = (source, keys) => Object.fromEntries(keys.filter((key) => key in (source || {})).map((key) => [key, source[key]]));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Die Anfrage eines Reiters: seine Felder aus dem Formular, alles andere wie gespeichert. ``maps``/``savedOrder`` wie bei seasonPayload. */
export function tabPayload(tab, form, saved, { maps, savedOrder } = {}) {
  const merged = { ...saved, ...pick(form, TAB_FIELDS[tab] || []) };
  return pick(seasonPayload(merged, maps ?? merged.best_of, savedOrder), TAB_PAYLOAD_KEYS[tab] || []);
}

/** Welche Reiter Ungespeichertes tragen. */
export function dirtyTabs(form, saved) {
  return Object.fromEntries(Object.entries(TAB_FIELDS).map(([tab, keys]) => [tab, Boolean(form && saved) && !same(pick(form, keys), pick(saved, keys))]));
}

/**
 * Neuer gespeicherter Stand: Reiter mit Ungespeichertem behalten ihre Eingaben, alle anderen (und die gerade gespeicherten in
 * ``reset``) nehmen den neuen Stand. So überschreibt „Termine speichern“ keine offene Eingabe im Reiter Tabelle.
 */
export function rebaseForm(form, oldSaved, newSaved, reset = []) {
  if (!form || !oldSaved) return newSaved;
  const dirty = dirtyTabs(form, oldSaved);
  const next = { ...newSaved };
  for (const [tab, keys] of Object.entries(TAB_FIELDS)) {
    if (dirty[tab] && !reset.includes(tab)) Object.assign(next, pick(form, keys));
  }
  return next;
}

// ---------------------------------------------------------------- Ablaufleiste

const STARTED = new Set(["live", "paused", "completed", "results_published"]);
const FINISHED = new Set(["completed", "results_published", "archived", "cancelled"]);
const SHORT = { day: "2-digit", month: "2-digit" };
const WITH_TIME = { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" };
const at = (value) => (value ? new Date(value).getTime() : null);

/**
 * Die Phasen einer Season, abgeleitet aus ihren Einstellungen (Kommentar Obmann 03.11. zu #2267): Vorbereitung → Anmeldung (Fenster)
 * → Einteilung → Spielbetrieb → Abschluss. Jede Phase hat `state` (done, current, upcoming, skipped), `when` und auf Wunsch `note`.
 * Der „Stand“ der Season bleibt die bewusste Schaltung der Leitung; „Beendet“ und „Archiviert“ schließen die Leiste ab.
 */
export function seasonPhases({ season = {}, calendar = null, divisions = [], now = new Date() }) {
  const time = now.getTime();
  const opens = at(season.application_opens_at);
  const closes = at(season.application_closes_at);
  const start = at(season.start_date);
  const weeks = calendar?.weeks || [];
  const lastDay = weeks.at(-1)?.end_day || "";
  const staffeln = (divisions || []).filter((row) => (row.status || "active") === "active").flatMap((row) => row.staffeln || []);
  const started = staffeln.some((row) => STARTED.has(row.status)) || (season.status === "active" && start != null && time >= start);
  const finished = ["completed", "archived"].includes(season.status)
    || (started && staffeln.length > 0 && staffeln.every((row) => FINISHED.has(row.status)));
  const published = ["members", "public"].includes(season.visibility);
  const hasWindow = opens != null && closes != null;

  let current;
  if (finished) current = 4;
  else if (started) current = 3;
  else if (hasWindow) current = time < opens ? 0 : time < closes ? 1 : 2;
  else current = published || staffeln.some((row) => row.participant_count > 0) ? 2 : 0;

  let weekNote = "";
  if (current === 3 && weeks.length) {
    const today = viennaDay(now);
    const week = weeks.find((row) => row.start_day <= today && today <= row.end_day);
    if (week) weekNote = week.blocked ? `Spielpause (Woche ${week.number} gesperrt)` : `Spielwoche ${week.number} von ${weeks.length}`;
  }
  const startText = start ? viennaDate(season.start_date, SHORT) : "";
  const steps = [
    { key: "vorbereitung", label: "Vorbereitung", when: hasWindow ? `bis ${viennaDate(season.application_opens_at, SHORT)}` : startText ? `bis ${startText}` : "",
      note: "Einstellungen, Regelwerk, Prüfung" },
    { key: "anmeldung", label: "Anmeldung", when: hasWindow ? `${viennaDateTime(season.application_opens_at, WITH_TIME)} – ${viennaDateTime(season.application_closes_at, WITH_TIME)}` : "ohne Selbstanmeldung",
      note: hasWindow ? "Co-Teams melden sich auf der Ligaseite an" : "Co-Teams teilst du in der Staffel zu" },
    { key: "einteilung", label: "Einteilung", when: startText ? `bis ${startText}` : "", note: "Staffeln anlegen, Co-Teams zuteilen, Staffel starten" },
    { key: "spielbetrieb", label: "Spielbetrieb", when: startText ? `${startText}${lastDay ? ` – ${viennaDate(dayNoon(lastDay), SHORT)}` : ""}` : "",
      note: weekNote || "Termine, Check-in je Spiel, Ergebnisse" },
    { key: "abschluss", label: "Abschluss", when: season.status === "archived" ? "archiviert" : season.status === "completed" ? "beendet" : "",
      note: "Tabelle steht, Stand auf „Beendet“" },
  ];
  return steps.map((step, index) => {
    if (step.key === "anmeldung" && !hasWindow) return { ...step, state: index < current ? "skipped" : current === index ? "current" : "skipped" };
    return { ...step, state: index < current ? "done" : index === current ? "current" : "upcoming" };
  });
}

// ---------------------------------------------------------------- Sichtbarkeit und Stand: was sie bewirken

export const VISIBILITY_EFFECT = {
  off: "Niemand sieht die Season: keine Ligaseite, kein Menüpunkt „Liga“. Wer in einer Staffel spielt, sieht seine Spiele trotzdem.",
  admins: "Vorschau: Nur der Bereich Ligen und die Zuständigen dieser Liga sehen die Ligaseite. Geht immer, auch mit offenen Punkten.",
  members: "Veröffentlicht für angemeldete Mitglieder. Geht nur, wenn die Prüfung keine Probleme mehr meldet.",
  public: "Veröffentlicht für alle, auch ohne Anmeldung. Geht nur, wenn die Prüfung keine Probleme mehr meldet.",
};

export const STATUS_EFFECT = {
  draft: "In Vorbereitung. Nur jetzt lässt sich die Season noch löschen. Mit dem Start der ersten Staffel springt der Stand von selbst auf „Läuft“.",
  active: "Im Spielbetrieb. Diesen Stand setzt der Start der ersten Staffel von selbst.",
  completed: "Abgeschlossen: keine Anmeldungen und keine Kaderänderungen mehr. Ligaseite und Tabellen bleiben sichtbar.",
  archived: "Ausgeblendet: Die Season verschwindet aus Ligaseite und Übersicht, alle Daten bleiben erhalten.",
};

// ---------------------------------------------------------------- Hinweise

/** Wiederholt der Beiname die Stufe („Liga 1“)? Die steht schon von selbst davor - der Titel hieße sonst „Liga 1 · Liga 1“. */
export function nicknameRepeatsLevel(nickname) {
  const words = String(nickname || "").trim().split(/\s+/).join(" ").toLowerCase();
  return /^liga ?\d{1,2}$/.test(words);
}

/** Wo „Modus je Map“ und die Modi mit Maps im Pool nicht zusammenpassen - als Sätze für die Stelle selbst. */
export function orderPoolHints(order, poolModes, labelOf = (mode) => mode) {
  const filled = (order || []).filter(Boolean);
  if (!filled.length || filled.length !== (order || []).length) return [];
  const pool = new Set(poolModes || []);
  const inOrder = [...new Set(filled)];
  const missing = inOrder.filter((mode) => !pool.has(mode)).map((mode) => `„${labelOf(mode)}“ steht in „Modus je Map“, hat aber keine Maps im Pool.`);
  const unused = [...pool].filter((mode) => mode && !inOrder.includes(mode))
    .map((mode) => `„${labelOf(mode)}“ hat Maps im Pool, kommt in „Modus je Map“ aber nie vor.`);
  return [...missing, ...unused];
}

/** „1 Baustein, 2 Variablen“ - was sich seit der letzten Fassung geändert hat (Zeilen aus ``data_changes``, #2269). */
export function changedPlaces(rows = []) {
  const variables = rows.filter((row) => row.kind === "variable").length;
  const blocks = rows.length - variables;
  const parts = [];
  if (blocks) parts.push(blocks === 1 ? "1 Baustein" : `${blocks} Bausteine`);
  if (variables) parts.push(variables === 1 ? "1 Variable" : `${variables} Variablen`);
  return parts.join(", ");
}

/**
 * Muss das Regelwerk freigegeben werden? ``view`` ist die Verwaltung des Regelwerks (nur mit „Regeln veröffentlichen“ lesbar, sonst
 * null), ``readiness`` die Prüfung. ``null``: alles in Ordnung.
 */
export function rulesNotice(view, readiness) {
  const codes = (readiness?.problems || []).map((row) => row.code);
  if (view?.data_changes?.rows?.length) {
    return { kind: "changed", text: `Seit ${view.data_changes.label} haben sich Werte geändert, die im Regelwerk stehen (${changedPlaces(view.data_changes.rows)}). Eine neue Fassung muss freigegeben werden.` };
  }
  if (view?.draft) return { kind: "draft", text: "Im Regelwerk liegt ein Entwurf, der noch nicht freigegeben ist." };
  // „missing“ meldet auch die Prüfung - der Überblick zeigt dann nur ihren Punkt, nicht denselben Satz zweimal.
  if (codes.includes("rules_missing") || (view && !view.current && !view.inherited && !(view.versions || []).length)) {
    return { kind: "missing", text: "Es gibt noch kein freigegebenes Regelwerk. Ohne gültige Fassung geht keine Anmeldung und keine Veröffentlichung." };
  }
  return null;
}
