// Öffentliche Ligaseite (docs/LIGA.md, P5, #1625): reine Helfer für Kopf, Spielwochen und Ergebnisse - ohne React,
// mit Tests. Alle Tage über die Wien-Helfer (lib/vienna.js).
import { dayNoon, viennaDate, viennaDateTime } from "@/lib/vienna";

const WEEKDAY_SHORT = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const WEEKDAY_LONG = ["Montag", "Dienstag", "Mittwoch", "Donnerstag", "Freitag", "Samstag", "Sonntag"];

/** Ein Kalendertag kurz: „21.12.“. */
export function shortDay(day) {
  return day ? viennaDate(dayNoon(day), { day: "numeric", month: "numeric" }) : "";
}

/** Zwei Kalendertage als Spanne: „21.12.–3.1.“. */
export function dayRange(first, last) {
  if (!first) return "";
  return first === last || !last ? shortDay(first) : `${shortDay(first)}–${shortDay(last)}`;
}

/** Zeitraum der Season: „10.11.2026 – 18.1.2027“. */
export function seasonPeriod(season) {
  const options = { day: "numeric", month: "numeric", year: "numeric" };
  const start = season?.start_date ? viennaDate(season.start_date, options) : "";
  const end = season?.end_date ? viennaDate(season.end_date, options) : "";
  return [start, end].filter(Boolean).join(" – ");
}

/** Wochentag (0 = Montag) des Starts in Wien. */
function startWeekday(season) {
  if (!season?.start_date) return null;
  const name = viennaDate(season.start_date, { weekday: "short" }) || "";
  const index = WEEKDAY_SHORT.findIndex((short) => name.toLowerCase().startsWith(short.toLowerCase()));
  return index >= 0 ? index : null;
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

/** Wann ein Spiel ist: „So 10.1. · 20:00“, „Standard“ wenn noch niemand einen Termin vereinbart hat. */
export function matchWhen(match) {
  if (!match?.scheduled_at) return "Termin offen";
  const text = viennaDateTime(match.scheduled_at, { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }) || "";
  return text.replace(", ", " · ").replace(/\.,/, ".");
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
