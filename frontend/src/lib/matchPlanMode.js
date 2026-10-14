// Welche Ansicht die Matchplan-Seite zeigt - dieselbe Regel wie der Spielplaner im Backend (Codex zu #1601):
//   services/tournament_rules.match_policy     Austragung: Spiel → Spiel-Einstellung → Phase → Turnier → alte Schalter → online
//   services/matchday_schedule.plays_in_matchdays  Spielwochen: Liga-Formate, nur wenn nicht vor Ort
//   services/match_scheduler.plan_schedule     Stationen nur für Spiele „vor Ort“ (hybrid nicht)
// Ändert sich dort etwas, gehört es hier mit - matchPlanMode.test.js hält die Fälle fest.

const EVENT_MODES = new Set(["local", "online", "hybrid"]);
const MATCHDAY_FORMATS = new Set(["league", "round_robin", "groups"]);
const MATCHDAY_STAGE_TYPES = new Set(["league", "round_robin_groups", "ffa_league"]);

function settingsOf(doc) {
  const settings = doc?.settings;
  return settings && typeof settings === "object" ? settings : {};
}

function legacyEventMode(tournament) {
  if (tournament?.is_hybrid === true) return "hybrid";
  if (tournament?.is_online === true) return "online";
  return null;
}

/** Die Austragung eines Spiels (oder einer Phase, ohne Spiel) - wie `match_policy(...)["event_mode"]`. */
export function eventModeOf(match, tournament, stage = null) {
  const candidates = [
    match?.event_mode, settingsOf(match).event_mode, settingsOf(stage).event_mode, stage?.event_mode,
    tournament?.event_mode, legacyEventMode(tournament),
  ];
  return candidates.find((value) => EVENT_MODES.has(value)) || "online";
}

/** Spielwochen statt Uhrzeiten - wie `plays_in_matchdays`. */
export function playsInMatchdays(tournament, stage = null) {
  const weekly = stage?.stage_type ? MATCHDAY_STAGE_TYPES.has(stage.stage_type) : MATCHDAY_FORMATS.has(tournament?.format);
  return weekly && eventModeOf({}, tournament, stage) !== "local";
}

/**
 * „local“ (Zeitleiste je Station), „league“ (Spielwochen) oder „online“ (Runden mit Fristen). Die Antwort des Planers
 * bestätigt („stations“/„mixed“, „matchdays“); „none“ heißt nur „nichts zu planen“ und ändert die Ansicht nicht.
 */
export function planViewMode({ tournament, stages = [], matches = [], plan = null } = {}) {
  if (plan?.mode === "stations" || plan?.mode === "mixed") return "local";
  if (plan?.mode === "matchdays") return "league";
  const stageById = new Map((stages || []).map((stage) => [stage?.id, stage]));
  const rows = (matches || []).filter(Boolean);
  const local = rows.length
    ? rows.some((match) => eventModeOf(match, tournament, stageById.get(match.stage_id)) === "local")
    : [null, ...(stages || [])].some((stage) => eventModeOf({}, tournament, stage) === "local");
  if (local) return "local";
  const weekly = rows.length
    ? rows.some((match) => playsInMatchdays(tournament, stageById.get(match.stage_id) || null))
    : [null, ...(stages || [])].some((stage) => playsInMatchdays(tournament, stage));
  return weekly ? "league" : "online";
}
