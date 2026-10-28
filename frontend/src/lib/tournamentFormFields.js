// Formulare nach Format und Austragung (#2111): welches Feld beim Anlegen und Bearbeiten eines Turniers überhaupt
// etwas bewirkt. Was hier nicht steht, bleibt sichtbar. Die Regeln folgen dem Server:
// - Spielwochen nur online/hybrid in Wochenformaten (services/matchday_schedule.py `plays_in_matchdays`),
// - Fristen je Austragung (services/match_deadlines.py `no_show_deadline`, `auto_confirm_due`),
// - Mindestpause nur, wo der Stationsplaner plant (services/match_scheduler.py),
// - „Struktur anwenden“ nur, wo es einen Generator gibt (services/competition_formats.py).

// Nur diese Formate spielen in Wochen; muss zu MATCHDAY_FORMATS in services/matchday_schedule.py passen.
export const WEEKLY_FORMATS = new Set(["league", "round_robin", "groups"]);
// Zeitfahren und Rennserie haben keinen Generator - es entstehen nie Spiele (#2111, TA6).
export const NO_MATCH_FORMATS = new Set(["time_trial", "grand_prix"]);
// Läufe mit mehreren Spielern: „Best of“ heißt dort Runden je Lauf und zählt nur für die geplante Dauer.
export const HEAT_FORMATS = new Set(["ffa", "battle_royale", "ffa_custom_bracket"]);
// Weiterkommen gibt es nur, wo Sieger in ein nächstes Spiel gehen (Turnierbaum).
export const BRACKET_FORMATS = new Set(["single_elim", "double_elim", "custom_bracket", "ffa_custom_bracket"]);
// Liga (Hin- und Rückrunde): statt Weiterkommen nur „Spieltage auslosen“ - Reihenfolge und Heimrecht
// (services/custom_bracket.py `_auto_league_schema`).
export const MATCHDAY_DRAW_FORMATS = new Set(["league"]);
// Kein Turnierbaum zum Vorausbauen: Schweizer Runden entstehen einzeln, Zeitfahren und Rennserie gar nicht.
export const NO_PREVIEW_FORMATS = new Set(["swiss", ...NO_MATCH_FORMATS]);
// Preisgruppen Gewinner-/Verliererrunde nur beim Doppel-K.-o.
export const LOSER_BRACKET_FORMATS = new Set(["double_elim"]);

const eventModeOf = (form) => (form?.event_mode === "local" || form?.event_mode === "hybrid" ? form.event_mode : "online");

/** Welche Felder zum Format und zur Austragung passen - `true` heißt anzeigen. */
export function tournamentFieldRules(form = {}) {
  const format = String(form?.format || "");
  const mode = eventModeOf(form);
  const weekly = WEEKLY_FORMATS.has(format);
  return {
    matchdays: weekly && mode !== "local",
    advancement: BRACKET_FORMATS.has(format) ? "select" : MATCHDAY_DRAW_FORMATS.has(format) ? "matchday_draw" : null,
    bestOf: !NO_MATCH_FORMATS.has(format),
    bestOfIsRuns: HEAT_FORMATS.has(format),
    matchBreak: mode !== "online",
    structureRebuild: !NO_PREVIEW_FORMATS.has(format),
    loserBracketPrizes: LOSER_BRACKET_FORMATS.has(format),
    onsite: mode !== "online",
    deadlines: {
      no_show_minutes_on_site: mode !== "online",
      no_show_minutes_online: mode !== "local",
      result_confirm_minutes_online: mode !== "local" && !weekly,
      result_confirm_hours_league: mode !== "local" && weekly,
    },
  };
}

export const BEST_OF_RUNS_HINT = "So viele Runden spielt ein Lauf – zählt für die geplante Dauer, wenn der Spielmodus je Runde rechnet.";

export const MATCHDAY_DRAW_HINT = "An: Reihenfolge der Spieltage und Heimrecht werden ausgelost, sobald der Spielplan feststeht – neu auslosen geht, solange kein Spiel begonnen hat. Aus: feste Reihenfolge nach der Setzliste.";

/** Der Schalter „Spieltage auslosen“: an heißt gemischt (Auslosung nach der Runde), aus heißt fester Plan. */
export const matchdayDrawOn = (advancementMode) => Boolean(advancementMode) && advancementMode !== "fixed";
export const matchdayDrawMode = (on) => (on ? "draw_round" : "fixed");
