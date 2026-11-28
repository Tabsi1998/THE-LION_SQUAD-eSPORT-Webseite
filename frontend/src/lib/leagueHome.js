// Liga auf der Startseite (#2324): Seasons aus dem Startseiten-Stand (``leagues``) als Zeilen in „Nächste Termine“ und als
// Hinweis, solange die Anmeldung offen ist. Wer was sieht und welche Plakette gilt, entscheidet der Server
// (backend/services/league_home.py); hier steht nur, wie es auf der Seite steht.
import { seatsLine } from "@/lib/leagueApplications";
import { formatRange, formatWhen } from "@/lib/datetime";


/** Eine Season als Zeile der Startseiten-Liste - im Format der Events und Turniere (``label``, ``url``, ``public_phase``). */
export function leagueTimelineItem(row) {
  return { ...row, kind: "league", label: row.title, source: "league", sourcePriority: 4 };
}

/** Wann die Zeile in der Liste dran ist: das nächste Datum, das zählt (Anmeldeschluss, Start, nächste Spielwoche). */
export function leagueSortTime(item) {
  const ms = item?.sort_at ? new Date(item.sort_at).getTime() : NaN;
  return Number.isFinite(ms) ? ms : Number.MAX_SAFE_INTEGER;
}

/** Der Zeitraum der Season: „Mo 16. November – So 24. Jänner 2027“ (#1307). */
export function periodLine(item) {
  if (!item?.start_date) return item?.end_date ? formatWhen(item.end_date, { time: false }) : "";
  return formatRange(item.start_date, item.end_date || null);
}

/** Freie Startplätze nur, solange angemeldet werden kann oder bald kann - danach zählt die Spielwoche. */
export function leagueSeatsLine(item) {
  const state = item?.application?.state;
  return state === "open" || state === "upcoming" ? seatsLine(item.application) : "";
}

/** Der Anmeldeschluss für den Hinweis: „Sa 21. November · 23:59“. */
export function deadlineText(value) {
  return value ? formatWhen(value) : "";
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
