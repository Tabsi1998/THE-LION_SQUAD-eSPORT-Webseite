// Liga auf der Startseite (#2324): Seasons aus dem Startseiten-Stand (``leagues``) als Zeilen in „Nächste Termine“ und als
// Hinweis, solange die Anmeldung offen ist. Wer was sieht und welche Plakette gilt, entscheidet der Server
// (backend/services/league_home.py); hier steht nur, wie es auf der Seite steht.
import { seatsLine } from "@/lib/leagueApplications";
import { viennaDate, viennaDateTime } from "@/lib/vienna";

const SHORT = { day: "2-digit", month: "2-digit", year: "numeric" };
const DEADLINE = { weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" };

/** Eine Season als Zeile der Startseiten-Liste - im Format der Events und Turniere (``label``, ``url``, ``public_phase``). */
export function leagueTimelineItem(row) {
  return { ...row, kind: "league", label: row.title, source: "league", sourcePriority: 4 };
}

/** Wann die Zeile in der Liste dran ist: das nächste Datum, das zählt (Anmeldeschluss, Start, nächste Spielwoche). */
export function leagueSortTime(item) {
  const ms = item?.sort_at ? new Date(item.sort_at).getTime() : NaN;
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** Der Zeitraum der Season: „16.11.2026 – 24.01.2027“. */
export function periodLine(item) {
  const start = item?.start_date ? viennaDate(item.start_date, SHORT) : "";
  const end = item?.end_date ? viennaDate(item.end_date, SHORT) : "";
  return [start, end].filter(Boolean).join(" – ");
}

/** Freie Startplätze nur, solange angemeldet werden kann oder bald kann - danach zählt die Spielwoche. */
export function leagueSeatsLine(item) {
  const state = item?.application?.state;
  return state === "open" || state === "upcoming" ? seatsLine(item.application) : "";
}

/** Der Anmeldeschluss für den Hinweis: „Sa., 21.11.2026, 23:59 Uhr“. */
export function deadlineText(value) {
  return value ? `${viennaDateTime(value, DEADLINE)} Uhr` : "";
}

/** Die Seasons, für die gerade angemeldet werden kann - nach Anmeldeschluss fällt eine von selbst heraus. */
export function openSignups(leagues, now = Date.now()) {
  return (leagues || []).filter((row) => {
    const closes = row?.application?.state === "open" ? new Date(row.application.closes_at).getTime() : NaN;
    return Number.isFinite(closes) && closes > now;
  });
}

/** Der nächste Anmeldeschluss in der Zukunft - dann muss der Hinweis neu rechnen. ``null`` ohne. */
export function nextDeadline(leagues, now = Date.now()) {
  const times = openSignups(leagues, now).map((row) => new Date(row.application.closes_at).getTime());
  return times.length ? Math.min(...times) : null;
}
