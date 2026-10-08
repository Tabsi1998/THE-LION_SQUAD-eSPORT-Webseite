// Aufruf (#1137): Hat die Turnierleitung das Spiel einer Station zugewiesen, zeigt die Matchseite der App, wohin es
// geht und wie lange noch - derselbe Countdown wie die Aufruf-Tafel am TV (frontend/src/lib/tvCalls.js → countdown).
// Das Ende („antreten bis“) rechnet der Server (services/match_calls.report_by).

export type MatchCall = { called_at?: string | null; report_by?: string | null; station_text?: string | null } | null | undefined;

/** „1:45“ bis zum Start - `done`, sobald die Zeit da ist; ohne Ziel kein Countdown. */
export function countdown(dueAt: number | null | undefined, now: number = Date.now()) {
  if (dueAt === null || dueAt === undefined || Number.isNaN(dueAt)) return { seconds: null as number | null, text: "", done: false };
  const seconds = Math.max(0, Math.ceil((dueAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return { seconds, text: `${minutes}:${String(seconds % 60).padStart(2, "0")}`, done: seconds === 0 };
}
