// Turnier-Bearbeitung (#223): Optionen und reine Helfer, die mehrere Teile der Seite teilen.

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

export const RESULT_ENTRY_MODE_OPTIONS = [["", "Automatisch passend"], ["staff_only", "Nur Turnierleitung"], ["player_confirmed", "Beide Parteien melden"], ["hybrid", "Hybrid"]];

export const SCHEDULE_MODE_OPTIONS = [["", "Automatisch passend"], ["fixed_by_staff", "Fix durch Turnierleitung"], ["player_proposal", "Teilnehmer schlagen vor"], ["hybrid", "Hybrid"]];

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

export function primaryTournamentAction(status) {
  if (["draft", "scheduled", "registration_open", "registration_closed"].includes(status)) {
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
