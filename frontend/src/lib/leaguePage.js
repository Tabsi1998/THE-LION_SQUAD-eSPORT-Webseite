// Öffentliche Ligaseite (docs/LIGA.md, P5, #1625): reine Helfer für Kopf, Spielwochen und Ergebnisse - ohne React,
// mit Tests. Alle Tage über die Wien-Helfer (lib/vienna.js).
import { formatRange, formatWhen } from "@/lib/datetime";
import { dayNoon, viennaDay } from "@/lib/vienna";

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Ein Kalendertag kurz: „Mo 21. Dezember“ (#1307). */
export function shortDay(day) {
  return day ? formatWhen(String(day).slice(0, 10), { time: false }) : "";
}

/** Zwei Kalendertage als Spanne: „Mo 21. Dezember – So 3. Jänner 2027“ (#1307). */
export function dayRange(first, last) {
  if (!first) return "";
  return formatRange(String(first).slice(0, 10), last ? String(last).slice(0, 10) : null);
}

/** Zeitraum der Season: „Di 10. November – Mo 18. Jänner 2027“ (#1307). */
export function seasonPeriod(season) {
  if (!season?.start_date) return season?.end_date ? formatWhen(season.end_date, { time: false }) : "";
  return formatRange(season.start_date, season.end_date || null);
}

/** Wochentag (0 = Montag) des Starts in Wien. */
function startWeekday(season) {
  if (!season?.start_date) return null;
  const day = viennaDay(season.start_date);
  return day ? (dayNoon(day).getUTCDay() + 6) % 7 : null;
}

/** Wie eine Spielwoche läuft: „Spielwoche Di–Mo“ (7 Tage) bzw. „Spielwoche 3 Tage“. */
export function weekSpan(season) {
  const days = Number(season?.matchday_days || 7);
  const first = startWeekday(season);
  if (days === 7 && first !== null) return `Spielwoche ${WEEKDAY_SHORT[first]}–${WEEKDAY_SHORT[(first + 6) % 7]}`;
  return `Spielwoche ${days} ${days === 1 ? "Tag" : "Tage"}`;
}

/** Der Standardtermin ohne Einigung: „Sonntag, 20:00 Uhr“. */
export function defaultSlot(season) {
  const day = WEEKDAY_LONG[Number(season?.default_match_weekday ?? 6)] || "Sonntag";
  return `${day}, ${season?.default_match_time || "20:00"} Uhr`;
}

/** „Weihnachtspause 21.12.–3.1.“ je Sperrzeit. */
export function blockedLines(season) {
  return (season?.blocked_periods || []).map((period) => ({
    key: `${period.start_date}-${period.end_date}`,
    label: period.label || "Sperrzeit",
    range: dayRange(period.start_date, period.end_date),
  }));
}

/** Punkte je Sieg/Remis/Niederlage: „3 / 1 / 0“. */
export function pointsLine(season) {
  const points = season?.match_points;
  return points ? `${points.win} / ${points.draw} / ${points.loss}` : "";
}

/** Der Kopf einer Woche: „KW 9 · 5.1.–11.1.“ (Kalenderwoche ab dem Start). */
export function weekHeading(week) {
  return `Woche ${week.week} · ${dayRange(week.first_day, week.last_day)}`;
}

/** Wann ein Spiel ist: „So 10. Jänner · 20:00“, „heute 20:00“ - ohne Termin „Termin offen“. */
export function matchWhen(match) {
  if (!match?.scheduled_at) return "Termin offen";
  return formatWhen(match.scheduled_at, { fallback: "Termin offen" });
}

export const SOURCE_LABELS = { accepted: "vereinbart", home: "Heimteam", default: "Standardtermin", manual: "Turnierleitung" };

/** Ergebnis-Zahlen „2 : 1“ oder nichts. */
export function scoreLine(match) {
  if (!match?.done) return "";
  const home = match.home?.score;
  const away = match.away?.score;
  return home == null || away == null ? "" : `${home} : ${away}`;
}

/** Wer ein Spiel gewonnen hat: "home", "away" oder null (offen, Remis). */
export function winnerSide(match) {
  if (!match?.winner_registration_id) return null;
  if (match.winner_registration_id === match.home?.registration_id) return "home";
  if (match.winner_registration_id === match.away?.registration_id) return "away";
  return null;
}

/** Die Woche, die beim Öffnen aufgeklappt ist: die laufende, sonst die erste mit offenem Spiel, sonst die letzte. */
export function openWeek(weeks, current) {
  if (!weeks?.length) return null;
  if (current && weeks.some((week) => week.week === current)) return current;
  const open = weeks.find((week) => week.matches?.some((match) => !match.done));
  return (open || weeks[weeks.length - 1]).week;
}

/** Die Ansicht eines Spieltags: wie viele Spiele gespielt sind. */
export function progressLine(week) {
  const total = week?.matches?.length || 0;
  if (!total) return "";
  const done = week.matches.filter((match) => match.done).length;
  return done === total ? "alle gespielt" : `${done} von ${total} gespielt`;
}

/** Adresse der Ligaseite. */
export function seasonPath(league, season) {
  return `/liga/${league?.slug}/${season?.slug}`;
}
