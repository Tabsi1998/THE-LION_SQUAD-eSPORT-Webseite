export const TOURNAMENT_FORMAT_LABELS = {
  single_elim: "Einzelausscheidung",
  double_elim: "Doppelausscheidung",
  round_robin: "Jeder gegen jeden",
  swiss: "Schweizer System",
  groups: "Gruppenphase",
  ffa: "Mehrspieler frei",
  battle_royale: "Überlebensmodus",
  league: "Liga",
  time_trial: "Zeitfahren",
  grand_prix: "Rennserie",
};

export const TOURNAMENT_FORMAT_OPTIONS = [
  ["single_elim", TOURNAMENT_FORMAT_LABELS.single_elim],
  ["double_elim", TOURNAMENT_FORMAT_LABELS.double_elim],
  ["round_robin", TOURNAMENT_FORMAT_LABELS.round_robin],
  ["swiss", TOURNAMENT_FORMAT_LABELS.swiss],
  ["groups", TOURNAMENT_FORMAT_LABELS.groups],
  ["ffa", TOURNAMENT_FORMAT_LABELS.ffa],
  ["battle_royale", TOURNAMENT_FORMAT_LABELS.battle_royale],
  ["league", TOURNAMENT_FORMAT_LABELS.league],
  ["time_trial", TOURNAMENT_FORMAT_LABELS.time_trial],
  ["grand_prix", TOURNAMENT_FORMAT_LABELS.grand_prix],
];

export const STAGE_TYPE_LABELS = {
  single_elimination: "Einzelausscheidung",
  double_elimination: "Doppelausscheidung",
  custom_bracket: "Freier Turnierbaum",
  round_robin_groups: "Jeder-gegen-jeden-Gruppen",
  swiss: "Schweizer System",
  league: "Liga",
  simple: "Einzelrunde",
  ffa_single_elimination: "Mehrspieler-Einzelausscheidung",
  ffa_custom_bracket: "Mehrspieler freier Turnierbaum",
  ffa_league: "Mehrspieler-Liga",
};

export const STAGE_TYPE_OPTIONS = [
  ["single_elimination", STAGE_TYPE_LABELS.single_elimination],
  ["double_elimination", STAGE_TYPE_LABELS.double_elimination],
  ["custom_bracket", STAGE_TYPE_LABELS.custom_bracket],
  ["round_robin_groups", STAGE_TYPE_LABELS.round_robin_groups],
  ["swiss", STAGE_TYPE_LABELS.swiss],
  ["league", STAGE_TYPE_LABELS.league],
  ["simple", STAGE_TYPE_LABELS.simple],
  ["ffa_single_elimination", STAGE_TYPE_LABELS.ffa_single_elimination],
  ["ffa_custom_bracket", STAGE_TYPE_LABELS.ffa_custom_bracket],
  ["ffa_league", STAGE_TYPE_LABELS.ffa_league],
];

export const MATCH_TYPE_LABELS = {
  duel: "Duell",
  ffa: "Mehrspieler",
};

export const MATCH_STATUS_LABELS = {
  preview: "Vorschau",
  pending: "Ausstehend",
  scheduled: "Geplant",
  ready: "Bereit",
  running: "Läuft",
  in_progress: "Läuft",
  waiting_result: "Wartet auf Ergebnis",
  completed: "Beendet",
  archived: "Archiviert",
  disputed: "Klärung nötig",
  forfeit: "Wertung",
  bye: "Freilos",
  no_show: "Nicht erschienen",
  free: "Frei",
  busy: "Belegt",
  broken: "Defekt",
  reserved: "Reserviert",
};

export const REGISTRATION_STATUS_LABELS = {
  pending: "Ausstehend",
  approved: "Bestätigt",
  rejected: "Abgelehnt",
  waitlist: "Warteliste",
  checked_in: "Eingecheckt",
  no_show: "Nicht erschienen",
};

export const REGISTRATION_STATUS_OPTIONS = [
  ["approved", REGISTRATION_STATUS_LABELS.approved],
  ["checked_in", REGISTRATION_STATUS_LABELS.checked_in],
  ["pending", REGISTRATION_STATUS_LABELS.pending],
  ["waitlist", REGISTRATION_STATUS_LABELS.waitlist],
];

export const STAGE_STATUS_OPTIONS = [
  ["pending", MATCH_STATUS_LABELS.pending],
  ["ready", MATCH_STATUS_LABELS.ready],
  ["running", MATCH_STATUS_LABELS.running],
  ["completed", MATCH_STATUS_LABELS.completed],
  ["archived", MATCH_STATUS_LABELS.archived],
];

export const STAFF_ROLE_LABELS = {
  organizer: "Organisation",
  referee: "Schiedsrichter",
  scorekeeper: "Ergebnisdienst",
  station_manager: "Stationsleitung",
  stream_operator: "Stream-Betreuung",
};

export const STAFF_ROLE_OPTIONS = [
  ["organizer", STAFF_ROLE_LABELS.organizer],
  ["referee", STAFF_ROLE_LABELS.referee],
  ["scorekeeper", STAFF_ROLE_LABELS.scorekeeper],
  ["station_manager", STAFF_ROLE_LABELS.station_manager],
  ["stream_operator", STAFF_ROLE_LABELS.stream_operator],
];

export const STAFF_SCOPE_LABELS = {
  tournament: "Ganzes Turnier",
  stage: "Phase",
  group: "Gruppe",
  station: "Station",
  match: "Spiel",
};

export const STAFF_SCOPE_OPTIONS = [
  ["tournament", STAFF_SCOPE_LABELS.tournament],
  ["stage", STAFF_SCOPE_LABELS.stage],
  ["group", STAFF_SCOPE_LABELS.group],
  ["station", STAFF_SCOPE_LABELS.station],
  ["match", STAFF_SCOPE_LABELS.match],
];

export const BRACKET_SECTION_LABELS = {
  WB: "Siegerbaum",
  LB: "Hoffnungsbaum",
  GF: "Großes Finale",
  MAIN: "Hauptfeld",
  FINAL: "Finale",
  winner: "Siegerbaum",
  loser: "Hoffnungsbaum",
  grand_final: "Großes Finale",
  bronze: "Spiel um Platz 3",
  round_robin: "Spieltage",
};

export const DEVICE_TYPE_LABELS = {
  switch: "Switch",
  switch2: "Switch 2",
  pc: "PC",
  racing_rig: "Renn-Setup",
  beamer: "Beamer",
  stream_setup: "Übertragungsplatz",
  admin_desk: "Orga-Tisch",
};

export const TEAM_MODE_LABELS = {
  solo: "Einzelspieler",
  duo: "Duo-Team",
  team: "Team",
  squad: "Squad / Gruppe",
};

function fallbackLabel(value) {
  if (!value) return "—";
  return String(value)
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

export function formatTournamentFormat(value) {
  return TOURNAMENT_FORMAT_LABELS[value] || fallbackLabel(value);
}

export function formatStageType(value) {
  return STAGE_TYPE_LABELS[value] || fallbackLabel(value);
}

export function formatMatchType(value) {
  return MATCH_TYPE_LABELS[value] || fallbackLabel(value);
}

export function formatMatchStatus(value) {
  return MATCH_STATUS_LABELS[value] || REGISTRATION_STATUS_LABELS[value] || fallbackLabel(value);
}

export function formatRegistrationStatus(value) {
  return REGISTRATION_STATUS_LABELS[value] || fallbackLabel(value);
}

export function formatBracketSection(value) {
  return BRACKET_SECTION_LABELS[value] || value || "Turnierbaum";
}

export function formatDeviceType(value) {
  return DEVICE_TYPE_LABELS[value] || fallbackLabel(value);
}

export function formatTeamMode(value) {
  return TEAM_MODE_LABELS[value] || fallbackLabel(value);
}

export function formatRoundName(value, number) {
  if (!value) return number ? `Runde ${number}` : "Runde";
  return String(value)
    .replace(/^Round\b/i, "Runde")
    .replace(/^Winner Final$/i, "Sieger-Finale")
    .replace(/^Loser Final$/i, "Hoffnungs-Finale")
    .replace(/^Grand Final$/i, "Großes Finale")
    .replace(/^Bronze Match$/i, "Spiel um Platz 3");
}

export function isLeagueSchedule(tournamentOrFormat, matchOrStage = {}) {
  const format = typeof tournamentOrFormat === "string"
    ? tournamentOrFormat
    : tournamentOrFormat?.format;
  const stageType = matchOrStage?.stage_type;
  return ["league", "round_robin"].includes(format)
    || ["league", "round_robin_groups", "ffa_league"].includes(stageType);
}

export function isHeatSchedule(tournamentOrFormat, matchOrStage = {}) {
  const format = typeof tournamentOrFormat === "string"
    ? tournamentOrFormat
    : tournamentOrFormat?.format;
  const stageType = matchOrStage?.stage_type;
  return matchOrStage?.match_type === "ffa"
    || ["ffa", "battle_royale", "grand_prix", "time_trial"].includes(format)
    || ["ffa_single_elimination", "ffa_custom_bracket"].includes(stageType);
}

export function formatScheduleGroupLabel(match = {}, tournament = {}) {
  if (match.matchday_label) return match.matchday_label;
  if (match.round_name) return formatRoundName(match.round_name, match.round);
  const number = match.matchday_number || match.round;
  if (isLeagueSchedule(tournament, match)) {
    return number ? `Spieltag ${number}` : "Spieltag";
  }
  if (isHeatSchedule(tournament, match)) {
    return number ? `Runde ${number}` : "Runde";
  }
  return number ? `Runde ${number}` : "Runde";
}

export function formatMatchKind(match = {}) {
  return isHeatSchedule(null, match) ? "Heat" : "Spiel";
}
