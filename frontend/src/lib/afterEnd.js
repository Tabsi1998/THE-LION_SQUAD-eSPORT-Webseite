// Seiten nach dem Ende (#1221): eine Regel „vorbei“ für Event-, Turnier- und Matchseite. Ab „vorbei“ fallen Knöpfe
// weg, die nur vorher Sinn haben - Kalender, „Live verfolgen“, „Display“, „Live-Refresh“ und die Terminabstimmung.
// Dieselbe Regel steht für die App in mobile/src/lib/afterEnd.ts.
import { isMatchFinished } from "@/lib/tournamentLabels";
import { viennaDay } from "@/lib/vienna";

const ENDED_STATUSES = new Set(["completed", "results_published", "archived", "cancelled"]);

/** Der letzte Tag eines Events in Wien: das Ende, sonst der letzte Programmtag, sonst der Beginn. */
function lastDayOf(event) {
  const days = event?.schedule?.days || [];
  const last = event?.end_date || days[days.length - 1]?.end_at || event?.start_date;
  return last ? viennaDay(last) : "";
}

/** Event: vorbei, wenn es beendet, archiviert oder abgesagt ist - oder sobald sein letzter Tag (Wiener Zeit) vorüber ist. */
export function eventIsOver(event, now = new Date()) {
  if (!event) return false;
  if (ENDED_STATUSES.has(event.status)) return true;
  const lastDay = lastDayOf(event);
  return Boolean(lastDay) && viennaDay(now) > lastDay;
}

/** Turnier: vorbei, wenn es beendet ist oder die Ergebnisse veröffentlicht sind (auch archiviert oder abgesagt). */
export function tournamentIsOver(tournament) {
  if (!tournament) return false;
  return ENDED_STATUSES.has(tournament.status) || ENDED_STATUSES.has(tournament.public_phase?.state);
}

/** Match: vorbei, wenn es beendet, gewertet oder ein Freilos ist (oder abgesagt). */
export function matchIsOver(match) {
  return isMatchFinished(match) || String(match?.status || "") === "cancelled";
}
