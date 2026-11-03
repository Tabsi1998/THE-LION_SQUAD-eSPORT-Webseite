// Turnier nach dem Ende noch „Live“ (#2194): Hinweis für die Leitung - „Läuft laut Stand noch, Ende war am … – beenden?“.
// Umgestellt wird nie automatisch; mit offenen Spielen läuft das Turnier öffentlich weiter, ohne fertig zu „Beendet“.
import { viennaDate, viennaTime } from "@/lib/vienna";

/** Steht das Turnier laut Stand auf „live“, obwohl sein Ende vorbei ist? */
export function liveAfterEnd(tournament, now = Date.now()) {
  if (String(tournament?.status || "") !== "live" || !tournament?.end_date) return false;
  const end = new Date(tournament.end_date).getTime();
  return Number.isFinite(end) && end < now;
}

export function endText(value) {
  if (!value) return "";
  return `${viennaDate(value, { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric" }).replace(".,", "")}, ${viennaTime(value, { hour: "2-digit", minute: "2-digit" })}`;
}

/** Der Satz des Hinweises: mit offenen Spielen „läuft länger“, sonst „beenden?“. */
export function endedLiveText(row) {
  const end = endText(row?.end_date);
  const open = Number(row?.open_matches || 0);
  if (open > 0) {
    return `Läuft laut Stand noch, Ende war am ${end}. ${open === 1 ? "1 Spiel ist" : `${open} Spiele sind`} noch offen – öffentlich steht „Läuft“.`;
  }
  return `Läuft laut Stand noch, Ende war am ${end} – alle Spiele sind fertig. Beenden oder Ergebnisse veröffentlichen?`;
}
