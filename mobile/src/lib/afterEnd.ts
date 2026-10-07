// Nach dem Ende (#1221): dieselbe Regel „vorbei“ wie auf der Website (frontend/src/lib/afterEnd.js). Ab „vorbei“
// verschwindet der Kalender-Knopf an Event, Turnier und Fast Lap - einen Termin, der war, trägt niemand mehr ein.
import { viennaDay } from "./vienna";

const ENDED_STATUSES = new Set(["completed", "results_published", "archived", "cancelled"]);

type Phase = { state?: string } | null | undefined;
type Dated = {
  status?: string | null;
  public_phase?: Phase;
  start_date?: string | null;
  end_date?: string | null;
  date?: string | null;
  schedule?: { days?: Array<{ end_at?: string | null }> } | null;
};

function endedByStatus(item: Dated): boolean {
  return ENDED_STATUSES.has(String(item.status || "")) || ENDED_STATUSES.has(String(item.public_phase?.state || ""));
}

function dayIsPast(value: string | null | undefined, now: Date): boolean {
  const day = value ? viennaDay(value) : "";
  return Boolean(day) && viennaDay(now) > day;
}

/** Event: vorbei, wenn es beendet, archiviert oder abgesagt ist - oder sobald sein letzter Tag (Wiener Zeit) vorüber ist. */
export function eventIsOver(event: Dated | null | undefined, now: Date = new Date()): boolean {
  if (!event) return false;
  if (ENDED_STATUSES.has(String(event.status || ""))) return true;
  const days = event.schedule?.days || [];
  return dayIsPast(event.end_date || days[days.length - 1]?.end_at || event.start_date || event.date, now);
}

/** Turnier: vorbei, wenn es beendet ist oder die Ergebnisse veröffentlicht sind (auch archiviert oder abgesagt). */
export function tournamentIsOver(tournament: Dated | null | undefined): boolean {
  return Boolean(tournament) && endedByStatus(tournament as Dated);
}

/** Fast Lap: vorbei, wenn die Challenge beendet ist oder ihr letzter Tag (Wiener Zeit) vorüber ist. */
export function challengeIsOver(challenge: Dated | null | undefined, now: Date = new Date()): boolean {
  if (!challenge) return false;
  return endedByStatus(challenge) || dayIsPast(challenge.end_date, now);
}
