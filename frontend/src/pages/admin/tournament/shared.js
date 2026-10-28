// Turnier-Bearbeitung (#223): Optionen und reine Helfer, die mehrere Teile der Seite teilen.
import { sideRoundLabel } from "@/lib/bracketNames";
import { sectionKind } from "@/lib/bracketSections";

export const TOURNAMENT_STATUS_OPTIONS = [
  ["draft", "Entwurf"],
  ["scheduled", "Angekündigt"],
  ["registration_open", "Anmeldung offen"],
  ["registration_closed", "Anmeldung geschlossen"],
  ["check_in", "Check-in offen"],
  ["live", "Live"],
  ["paused", "Pausiert"],
  ["completed", "Beendet"],
  ["results_published", "Ergebnisse veröffentlicht"],
  ["archived", "Archiviert"],
  ["cancelled", "Abgesagt"],
];

export const OPERATIONAL_STATUS_VALUES = new Set(["check_in", "live", "paused", "completed"]);

export const TEAM_MODE_OPTIONS = [["solo", "Einzelspieler"], ["team", "Team"]];

export const SEEDING_OPTIONS = [["random", "Zufall"], ["manual", "Manuell"], ["ranking", "Ranking"]];

export const VISIBILITY_OPTIONS = [["public", "Öffentlich"], ["community", "Community"], ["members", "Vereinsmitglieder"], ["internal", "Intern"]];

export const STREAM_PLATFORM_OPTIONS = [["", "—"], ["twitch", "Twitch"], ["youtube", "YouTube"], ["kick", "Kick"], ["custom", "Eigene Plattform"]];

export const EVENT_MODE_OPTIONS = [["online", "Online"], ["local", "Vor Ort"], ["hybrid", "Hybrid"]];

export const RESULT_ENTRY_MODE_OPTIONS = [["", "Automatisch (online melden Spieler, vor Ort die Turnierleitung)"], ["staff_only", "Nur Turnierleitung"], ["player_confirmed", "Beide Parteien melden"], ["hybrid", "Hybrid"]];

export const SCHEDULE_MODE_OPTIONS = [["", "Automatisch (online abstimmen, vor Ort fix)"], ["fixed_by_staff", "Fix durch Turnierleitung"], ["player_proposal", "Teilnehmer schlagen vor"], ["hybrid", "Hybrid"]];

export const TOURNAMENT_SEASON_WEIGHT_OPTIONS = [
  ["3", "Major - grosses Turnier (x3.00)"],
  ["2", "Normal - regulaeres Turnier (x2.00)"],
  ["1.25", "Mini - kleines Turnier (x1.25)"],
  ["1", "Kleine Challenge / Fast-Lap nah (x1.00)"],
  ["0.75", "Fun-Wertung (x0.75)"],
  ["0.5", "Event/Check-in Wertung (x0.50)"],
  ["0", "Keine Jahreswertung (x0.00)"],
];

export const DEFAULT_FFA_SCHEMA = `[WB]
# Runde 1
A=[1,2,3,4]
B=[5,6,7,8]

# Runde 2
C=[W:A:1,W:A:2,W:B:1,W:B:2]

[LB]
# Runde 1
LA=[L:A:1,L:A:2,L:B:1,L:B:2]`;

export const CUSTOM_STAGE_TYPES = new Set(["custom_bracket", "ffa_custom_bracket"]);
// Die beiden Turnierformate, bei denen die Turnierleitung den Baum selbst
// schreibt. Nur hier hat das Bearbeiten-Formular überhaupt Strukturfelder.

export const CUSTOM_BRACKET_FORMATS = new Set(["custom_bracket", "ffa_custom_bracket"]);
// Strukturen, die das Backend aus dem Format bauen kann. Schweizer Runden
// fehlen hier bewusst: die entstehen einzeln über "Schweizer Runde".

export const AUTO_STAGE_TYPES = new Set([
  "single_elimination", "double_elimination", "custom_bracket", "ffa_custom_bracket",
  "round_robin_groups", "league", "simple",
]);

export const FFA_STAGE_TYPES = new Set(["simple", "ffa_single_elimination", "ffa_custom_bracket", "ffa_league"]);

export const BRONZE_FORMATS = new Set(["single_elim"]);

// Grand Final beim Doppel-K.-o. (#1549): Vorgabe mit Reset - wer aus der Verliererrunde das erste Finale gewinnt,
// hat beide Seiten einmal geschlagen; der Sieger der Siegerrunde bekommt dann sein zweites Leben im Reset-Spiel.
export const GRAND_FINAL_FORMATS = new Set(["double_elim"]);
export const GRAND_FINAL_OPTIONS = [
  ["reset", "Mit Reset-Spiel (Standard): Gewinnt die Verliererrunde das Finale, wird ein zweites Finale gespielt"],
  ["single", "Ein Finale: Sieger der Siegerrunde gegen Sieger der Verliererrunde, ohne Reset"],
  ["none", "Kein Grand Final: Der Sieger der Siegerrunde gewinnt das Turnier"],
];
export const GRAND_FINAL_HINT = "Beide Finalisten haben im Doppel-K.-o. ein zweites Leben. Ohne Reset hätte der Sieger der Siegerrunde nach nur einer Niederlage verloren.";

// Weiterkommen in vier Modi (#1548, #1590): am Server `advancement_mode`; der alte Schalter
// `randomize_advancement_rounds` wird gelesen (an → Auslosung nach der Runde) und vom Server als Spiegel mitgeführt.
// An der Phase heißt leer „vom Turnier erben“.
export const ADVANCEMENT_MODES = ["fixed", "draw_round", "draw_show", "instant"];
export const ADVANCEMENT_MODE_OPTIONS = [
  ["fixed", "Fester Baum (Standard): Wer weiterkommt, geht in das Spiel, das der Turnierbaum vorsieht"],
  ["draw_round", "Auslosung nach der Runde: Sind alle Spiele einer Runde fertig, lost der Server alle Weiterkommer auf einmal"],
  ["draw_show", "Show-Auslosung: Die Runde wartet, bis die Turnierleitung „Jetzt auslosen“ tippt – TV und Baum zeigen vorher den Topf"],
  ["instant", "Sofort zufällig: Jeder Weiterkommer kommt sofort auf einen zufälligen freien Platz der nächsten Runde"],
];
export const ADVANCEMENT_MODE_HINTS = {
  fixed: "Die Zuordnung steht im Turnierbaum: Sieger aus A trifft Sieger aus B.",
  draw_round: "Erst wenn alle Spiele einer Runde fertig sind, kommen alle Weiterkommer in einen Topf und werden gleichmäßig auf die nächsten Spiele verteilt – auch zwei aus demselben Spiel können sich wiedersehen. Laufen nur zwei Spiele in eines zusammen (z. B. das Finale), ändert sich nichts. In der Liga werden die Reihenfolge der Spieltage und das Heimrecht ausgelost. Neu auslosen geht, bis die Runde beginnt.",
  draw_show: "Wie die Auslosung nach der Runde, nur lost erst die Turnierleitung mit „Jetzt auslosen“ (Turnierleitung-Ansicht, Reiter Spiele). Bis dahin steht im Baum „Auslosung bereit“. Nach der eingestellten Zeit erinnert der Server; nach noch einmal so viel Zeit lost er selbst.",
  instant: "Ist ein Spiel fertig, kommt jeder Weiterkommer sofort auf einen zufälligen freien Platz der nächsten Runde (gleiche Runde, gleicher Abschnitt). Ein Spiel kann starten, sobald es voll ist – alles kann passieren. Neu auslosen geht für die Spiele, die noch nicht begonnen haben.",
};
export const ADVANCEMENT_MODE_HINT = ADVANCEMENT_MODE_HINTS.draw_round;
export const STAGE_ADVANCEMENT_OPTIONS = [["", "Vom Turnier erben"], ...ADVANCEMENT_MODE_OPTIONS];
export const DRAW_SHOW_MINUTES_DEFAULT = 10;
export const DRAW_SHOW_MINUTES_HINT = "Nach so vielen Minuten erinnert der Server die Turnierleitung, nach noch einmal so vielen lost er selbst. Leer: 10 Minuten.";
/** Der Modus eines Turniers, einer Phase oder eines Spiels - auch aus älteren Daten, die nur den Schalter kennen. */
export function advancementModeOf(source) {
  const value = source && typeof source === "object" ? source.advancement_mode : source;
  if (ADVANCEMENT_MODES.includes(value)) return value;
  const legacy = source && typeof source === "object" ? source.randomize_advancement_rounds : null;
  if (legacy === true || source === true) return "draw_round";
  return "fixed";
}
export const advancementModeHint = (mode) => ADVANCEMENT_MODE_HINTS[mode] || ADVANCEMENT_MODE_HINTS.fixed;
export function stageAdvancementValue(settings) {
  if (ADVANCEMENT_MODES.includes(settings?.advancement_mode)) return settings.advancement_mode;
  const value = settings?.randomize_advancement_rounds;
  if (value === true) return "draw_round";
  if (value === false) return "fixed";
  return "";
}
/** Was die Phase speichert: Modus und Schalter im Gleichschritt, leer heißt erben. */
export function stageAdvancementSettings(value) {
  if (!ADVANCEMENT_MODES.includes(value)) return { advancement_mode: null, randomize_advancement_rounds: null };
  return { advancement_mode: value, randomize_advancement_rounds: value !== "fixed" };
}
export function stageAdvancementSetting(value) {
  return stageAdvancementSettings(value).randomize_advancement_rounds;
}
/** Minuten der Show-Auslosung aus dem Formular: leer bleibt leer (Vorgabe), sonst eine ganze Zahl ab 1. */
export function drawShowMinutesPayload(value) {
  const number = Number.parseInt(String(value ?? "").trim(), 10);
  return Number.isFinite(number) && number >= 1 ? Math.min(number, 240) : null;
}

// Neu auslosen (#1548): gleich wie am Server (`_draw_started`) - ist eines der Spiele aufgerufen, gestartet, gemeldet
// oder entschieden, gilt das Los.
const DRAW_LOCKED_STATUSES = new Set(["in_progress", "waiting_result", "disputed", "completed", "forfeit"]);
export function drawStarted(match) {
  return DRAW_LOCKED_STATUSES.has(match?.status) || (match?.results || []).length > 0 || !!match?.started_at
    || !!match?.called_at || (match?.reports || []).length > 0 || !!match?.pending_result;
}

/** Ein Platz, der sein Los schon hat (#1590, sofort zufällig: je Platz, nicht je Runde). */
export const slotDrawn = (slot) => Boolean(slot?.source?.draw && (slot?.source_result?.draw_id || (slot?.registration_id && slot?.source_result?.from_match_key)));
const slotOpen = (slot) => Boolean(slot?.source?.draw) && slot?.status === "pending" && !slot?.registration_id && !slot?.source_result;

/**
 * Die Auslosungs-Gruppen einer Phase: Runde, Spiele, Modus, ob schon gelost und ob neu auslosen noch geht. Show
 * (#1590): `ready`, sobald der Topf steht und die Leitung losen darf. Sofort zufällig: `assigned`/`open` je Platz,
 * neu auslosen nur für die Spiele, die noch nicht begonnen haben (`redrawKeys`). Die Runde heißt wie im Baum (#1860):
 * „Winner Runde 2“, „Loser Runde 1“ - bei gleicher Runde Winner vor Loser.
 */
const DRAW_SIDE_ORDER = { main: 0, loser: 1 };

export function drawGroupsOf(matches = []) {
  const groups = new Map();
  for (const match of matches || []) {
    const group = match?.settings?.draw_group;
    if (!group || match.status === "cancelled") continue;
    if (!groups.has(group)) groups.set(group, []);
    groups.get(group).push(match);
  }
  return [...groups.entries()].map(([group, rows]) => {
    const sorted = [...rows].sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.match_key).localeCompare(String(b.match_key)));
    const mode = advancementModeOf(sorted[0]?.settings);
    const slots = sorted.flatMap((row) => row.slots || []);
    const assigned = slots.filter(slotDrawn).length;
    const open = slots.filter(slotOpen).length;
    const drawn = mode === "instant" ? assigned > 0 : sorted.some((row) => row.draw && typeof row.draw === "object");
    const unstarted = sorted.filter((row) => !drawStarted(row));
    const canRedraw = mode === "instant"
      ? unstarted.some((row) => (row.slots || []).some(slotDrawn))
      : drawn && unstarted.length === sorted.length;
    return {
      group,
      mode,
      label: sideRoundLabel(sorted[0], matches) || `Runde ${sorted[0]?.round || ""}`.trim(),
      section: sorted[0]?.section || "",
      round: sorted[0]?.round || 0,
      matchKeys: sorted.map((row) => row.match_key),
      redrawKeys: (mode === "instant" ? unstarted : sorted).map((row) => row.match_key),
      drawn,
      ready: mode === "draw_show" && !drawn && sorted.some((row) => row.draw_ready && typeof row.draw_ready === "object"),
      assigned,
      open,
      canRedraw,
    };
  }).sort((a, b) => a.round - b.round
    || (DRAW_SIDE_ORDER[sectionKind(a.section)] ?? 2) - (DRAW_SIDE_ORDER[sectionKind(b.section)] ?? 2)
    || a.group.localeCompare(b.group));
}

/** Liga: Spieltage neu auslosen geht nur gemischt und nur, solange kein Spiel begonnen hat. */
export function leagueRedrawAllowed(stage, matches = []) {
  if (stage?.stage_type !== "league") return false;
  const rows = (matches || []).filter((match) => match.status !== "cancelled");
  if (!rows.length || !rows.some((match) => match.settings?.randomize_advancement_rounds)) return false;
  return !rows.some(drawStarted);
}
// Läufe umbauen (#1550, Entscheidung E13): unterbesetzte Läufe zusammenlegen, ausgleichen, abkürzen - als Vorschlag
// für die Turnierleitung (Vorgabe) oder automatisch. Auffüllen und Freilos laufen immer von selbst.
export const HEAT_REBUILD_FORMATS = new Set(["ffa_custom_bracket"]);
export const HEAT_REBUILD_OPTIONS = [
  ["suggest", "Vorschlag (Standard): Die Turnierleitung bestätigt Zusammenlegen, Ausgleichen und Abkürzen mit einem Klick"],
  ["auto", "Automatisch: Läufe werden ohne Rückfrage zusammengelegt, ausgeglichen und abgekürzt"],
];
export const HEAT_REBUILD_HINT = "Ist das Turnier nicht voll oder fallen Fahrer aus, werden unterbesetzte Läufe zusammengelegt (2 + 2 wird ein Lauf mit 4). Laufende und aufgerufene Läufe bleiben unangetastet.";
// Nur diese Formate spielen in Wochen; ein K.-o.-Baum hat Runden, keine Woche.
// Muss zu MATCHDAY_FORMATS in services/matchday_schedule.py passen.

export const MATCHDAY_FORMATS = new Set(["league", "round_robin", "groups"]);

export const WEEKDAY_OPTIONS = [
  ["0", "Montag"], ["1", "Dienstag"], ["2", "Mittwoch"], ["3", "Donnerstag"],
  ["4", "Freitag"], ["5", "Samstag"], ["6", "Sonntag"],
];

export const MATCH_SECTION_ORDER = ["WB", "winner", "MAIN", "main", "LB", "loser", "BRONZE", "bronze", "GF", "grand_final", "FINAL", "final", "round_robin"];

export function matchSectionKey(match) {
  return match?.section || match?.bracket || "MAIN";
}

export function sectionSortIndex(section) {
  const key = String(section || "MAIN").toLowerCase();
  const idx = MATCH_SECTION_ORDER.findIndex((item) => String(item).toLowerCase() === key);
  return idx === -1 ? 99 : idx;
}

export function matchSortValue(match) {
  return [
    sectionSortIndex(matchSectionKey(match)),
    Number(match?.round ?? match?.round_index ?? 0),
    Number(match?.order ?? match?.match_index ?? match?.number ?? 0),
    String(match?.match_key || match?.id || ""),
  ];
}

export function normalizeSearch(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

export function sortMatchesForPlan(a, b) {
  const av = matchSortValue(a);
  const bv = matchSortValue(b);
  for (let i = 0; i < av.length; i += 1) {
    if (av[i] < bv[i]) return -1;
    if (av[i] > bv[i]) return 1;
  }
  return 0;
}

export function stationDisplay(match, stations = []) {
  if (!match) return "";
  const direct = match.station_label || match.station_name || match.station?.name;
  if (direct) return direct;
  const station = stations.find((item) => item.id === match.station_id);
  if (station) return station.name || station.label || station.id;
  return match.station_id || "";
}

export function matchTypeForStage(stageType) {
  return FFA_STAGE_TYPES.has(stageType) ? "ffa" : "duel";
}

export function stageConfigFor(form) {
  const stageType = form.stage_type || "ffa_custom_bracket";
  const matchType = form.match_type || matchTypeForStage(stageType);
  const custom = CUSTOM_STAGE_TYPES.has(stageType);
  const ffa = matchType === "ffa" || FFA_STAGE_TYPES.has(stageType);
  return {
    custom,
    ffa,
    showMatchSize: ffa,
    showMinPlayers: ffa,
    showQualifiers: ffa,
    showSchema: custom,
    canGenerate: AUTO_STAGE_TYPES.has(stageType),
  };
}

export function applyStageType(current, stageType) {
  const matchType = matchTypeForStage(stageType);
  const custom = CUSTOM_STAGE_TYPES.has(stageType);
  return {
    ...current,
    stage_type: stageType,
    match_type: matchType,
    match_size: matchType === "ffa" ? (current.match_size || 4) : 2,
    min_players: matchType === "ffa" ? (current.min_players || 2) : 2,
    qualifiers_per_match: matchType === "ffa" ? (current.qualifiers_per_match || 2) : 1,
    schema: custom ? current.schema : "",
  };
}

// Folgenschwere Aktionen (#2120): dieselben Regeln wie `services/tournament_guard.py` am Server - der Server prüft
// selbst, die Seite zeigt nur vorher, was passiert.
const PRE_START_STATUSES = new Set(["draft", "scheduled", "registration_open", "registration_closed", "check_in"]);
export const FINISHED_STATUSES = new Set(["completed", "results_published", "archived"]);
const REBUILDABLE_MATCH_STATUSES = new Set(["pending", "ready", "scheduled", "cancelled"]);
const BYE_SOURCES = new Set(["auto_bye", "swiss_bye"]);

const isBye = (match) => match?.status === "completed" && BYE_SOURCES.has(match?.result_meta?.source);

/** Hat ein Spiel begonnen - aufgerufen, gestartet, gemeldet oder gewertet? Ein Freilos zählt nicht. */
export function matchBegun(match) {
  if (!match || match.is_preview || isBye(match)) return false;
  return drawStarted(match);
}

/** Wie viele echte (nicht Vorschau-)Spiele es gibt und wie viele davon begonnen oder gewertet sind. */
export function matchImpact(matches = []) {
  const real = (matches || []).filter((match) => !match?.is_preview);
  const played = real.filter((match) => {
    const rebuildable = REBUILDABLE_MATCH_STATUSES.has(match.status || "pending")
      || (match.status === "completed" && match.result_meta?.source === "auto_bye");
    return !rebuildable || matchBegun(match);
  });
  return { match_count: real.length, played_count: played.length };
}

/** „12 Spiele, davon 3 begonnen oder gewertet“ - wie der Server es in seinen Rückfragen schreibt. */
export function impactText(impact) {
  const count = Number(impact?.match_count) || 0;
  const played = Number(impact?.played_count) || 0;
  const games = count === 1 ? "1 Spiel" : `${count} Spiele`;
  return played ? `${games}, davon ${played} begonnen oder gewertet` : `${games}, keines davon begonnen`;
}

/** Steht der Turnierbaum? Ab dem Ende des Check-ins, nach dem Start oder sobald es echte Spiele gibt. */
export function bracketFixed(tournament, matches = []) {
  if (!tournament) return false;
  if (tournament.check_in_closed_at || !PRE_START_STATUSES.has(tournament.status)) return true;
  return (matches || []).some((match) => !match?.is_preview);
}

/** Anmeldungen, die in einem festen Spiel stehen - die lassen sich nicht einfach entfernen oder ablehnen. */
export function fixedRegistrationIds(matches = []) {
  const ids = new Set();
  for (const match of matches || []) {
    if (match?.is_preview) continue;
    for (const slot of match?.slots || []) if (slot?.registration_id) ids.add(slot.registration_id);
  }
  return ids;
}

/** Die 409-Antwort des Servers vor einer Löschung (`confirm_destruction`) bzw. einer verweigerten Vorschau. */
export function guardDetail(error, code) {
  const detail = error?.response?.status === 409 ? error.response?.data?.detail : null;
  return detail && typeof detail === "object" && detail.code === code ? detail : null;
}

/** Die letzte Schweizer Runde, solange keines ihrer Spiele begonnen hat - sonst `null`. */
export function swissUndoInfo(matches = []) {
  const rows = (matches || []).filter((match) => !match?.is_preview);
  if (!rows.length) return null;
  const round = Math.max(...rows.map((match) => Number(match.round) || 0));
  const last = rows.filter((match) => (Number(match.round) || 0) === round);
  if (last.some((match) => matchBegun(match) || match.station_id)) return null;
  return { round, count: last.length };
}

/**
 * Rückfrage vor einem Statuswechsel mit Folgen (#2120, TA24) - oder `null`, wenn der Status einfach wechselt. Live hat
 * seine eigene Rückfrage (Planung prüfen). `askReason`: Abgesagt fragt nach einem freiwilligen Grund für die Nachricht.
 */
export function statusChangeNotice(status, tournament, { activeRegistrations = 0 } = {}) {
  if (!tournament || status === tournament.status) return null;
  if (status === "draft") {
    return {
      title: "Zurück auf Entwurf?",
      description: "Die öffentliche Seite und die Anmeldung verschwinden, bis das Turnier wieder angekündigt wird. Angemeldete bekommen keine Nachricht.",
      confirmLabel: "Auf Entwurf setzen",
      tone: "danger",
    };
  }
  if (status === "completed" && !FINISHED_STATUSES.has(tournament.status)) {
    return {
      title: "Turnier beenden?",
      description: "Alle Beteiligten bekommen einmal die Nachricht „Turnier beendet“, die Erfolge werden ausgewertet. Die Turnierseite zeigt das Podest als vorläufig.",
      confirmLabel: "Beenden",
      tone: "info",
    };
  }
  if (status === "results_published") {
    return {
      title: "Ergebnisse veröffentlichen?",
      description: "Jetzt vergibt das System die Punkte für die Jahreswertung, Pokale und Auszeichnungen und legt die Gewinne an. Wer noch nicht Bescheid hat, bekommt „Turnier beendet“. Das lässt sich nicht mit einem Klick zurücknehmen.",
      confirmLabel: "Veröffentlichen",
      tone: "danger",
    };
  }
  if (status === "cancelled") {
    const count = Number(activeRegistrations) || 0;
    const who = count === 1 ? "Die 1 Anmeldung bekommt" : count ? `Alle ${count} Anmeldungen bekommen` : "Angemeldete bekommen";
    return {
      title: "Turnier absagen?",
      description: `${who} eine Nachricht (Postfach und Push). Ein Grund ist freiwillig und steht in dieser Nachricht.`,
      confirmLabel: "Absagen",
      tone: "danger",
      askReason: true,
      placeholder: "z. B. Halle nicht verfügbar",
    };
  }
  return null;
}

export function primaryTournamentAction(status, tournament = null) {
  if (["draft", "scheduled", "registration_open", "registration_closed"].includes(status)) {
    // Liga-Staffel (docs/LIGA.md): die Co-Teams sind zugeteilt, niemand checkt ein - „Live“ macht den Spielplan fest.
    // Ein Check-in ließe die Staffel ohne eingecheckte Teams und damit ohne Spiele zurück (#2096, im Durchlauf gefunden).
    if (tournament?.league_context) return { status: "live", label: "Liga starten" };
    return { status: "check_in", label: "Check-in starten" };
  }
  if (status === "check_in") {
    return { status: "live", label: "Turnier starten" };
  }
  if (status === "paused") {
    return { status: "live", label: "Fortsetzen" };
  }
  return null;
}
