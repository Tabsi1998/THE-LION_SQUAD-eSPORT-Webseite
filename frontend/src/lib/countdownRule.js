import { dayNoon, viennaDate, viennaDay, viennaTime } from "./vienna";

// Countdown nur, wenn es bald so weit ist (#1264) - eine Regel für alle Termin-Angaben der Website (Startseite,
// Zustands-Schild, Zeitleiste der Turnierseite):
// - mehr als 60 Tage: der Monat („im März“),
// - bis 60 Tage: das Datum („Sa 14. November“, mehrtägig „Do 11. – So 14. März“),
// - ab der Countdown-Schwelle (Vorgabe 14 Tage, einstellbar unter Branding): „in 13 Tagen“,
// - am Vortag „morgen 14:00“, am Tag selbst „heute 14:00“, in der letzten Stunde „in 45 Minuten“.
// Tage zählen am Wiener Kalender, nicht in 24-Stunden-Schritten - die Zeitumstellung macht Tage mit 23 und 25 Stunden.
// Keine Abkürzungen wie „154T 16H“.

export const COUNTDOWN_DAYS_DEFAULT = 14;
export const DATE_DAYS = 60;
// Weiter als rund elf Monate weg: zum Monat das Jahr, sonst hieße „im März“ auch der März in zwei Jahren.
const YEAR_AFTER_DAYS = 330;
const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

/** Die eingestellte Schwelle in Tagen (1 bis 60) - ohne gültigen Wert die Vorgabe 14. */
export function countdownDays(value) {
  const days = Number(value);
  return value != null && value !== "" && Number.isInteger(days) && days >= 1 && days <= DATE_DAYS ? days : COUNTDOWN_DAYS_DEFAULT;
}

function toMs(value) {
  if (value == null || value === "") return NaN;
  if (typeof value === "number") return value;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : NaN;
}

/** Wie viele Kalendertage (Wien) zwischen zwei Zeitpunkten liegen - 0 am selben Tag, 1 am nächsten. */
export function calendarDaysBetween(fromMs, toMs_) {
  return Math.round((dayNoon(viennaDay(toMs_)).getTime() - dayNoon(viennaDay(fromMs)).getTime()) / DAY_MS);
}

const clock = (ms) => viennaTime(ms, { hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const weekday = (ms) => viennaDate(ms, { weekday: "short" }).replace(/\.$/, "");
const dayNumber = (ms) => Number(viennaDay(ms).slice(8, 10));
const monthName = (ms) => viennaDate(ms, { month: "long" });
const yearOf = (ms) => viennaDay(ms).slice(0, 4);

/** „Sa 14. November“ bzw. mehrtägig „Do 11. – So 14. März“ / „Fr 30. Oktober – So 1. November“. */
function dateText(startMs, endMs) {
  const start = `${weekday(startMs)} ${dayNumber(startMs)}.`;
  if (!Number.isFinite(endMs) || endMs <= startMs || viennaDay(endMs) === viennaDay(startMs)) return `${start} ${monthName(startMs)}`;
  const end = `${weekday(endMs)} ${dayNumber(endMs)}. ${monthName(endMs)}`;
  return monthName(startMs) === monthName(endMs) && yearOf(startMs) === yearOf(endMs) ? `${start} – ${end}` : `${start} ${monthName(startMs)} – ${end}`;
}

function minutesText(diff) {
  const minutes = Math.floor(diff / MINUTE_MS);
  if (minutes < 1) return "in unter einer Minute";
  return minutes === 1 ? "in 1 Minute" : `in ${minutes} Minuten`;
}

/**
 * Wann ein Termin ist, nach der einen Regel. `mode`: "now" | "minutes" | "today" | "tomorrow" | "days" | "date" |
 * "month"; `text` steht für sich („in 3 Tagen“, „Sa 14. November“, „im März“). `null` ohne gültigen Zeitpunkt.
 * `end`: Ende eines mehrtägigen Termins (für den Datumsbereich), `days`: die Countdown-Schwelle.
 */
export function whenText(target, { now = Date.now(), end = null, days = COUNTDOWN_DAYS_DEFAULT } = {}) {
  const targetMs = toMs(target);
  if (!Number.isFinite(targetMs)) return null;
  const diff = targetMs - now;
  if (diff <= 0) return { mode: "now", text: "jetzt" };
  const calendarDays = calendarDaysBetween(now, targetMs);
  if (calendarDays <= 0) return diff < HOUR_MS ? { mode: "minutes", text: minutesText(diff) } : { mode: "today", text: `heute ${clock(targetMs)}` };
  if (calendarDays === 1) return { mode: "tomorrow", text: `morgen ${clock(targetMs)}` };
  if (calendarDays <= countdownDays(days)) return { mode: "days", text: `in ${calendarDays} Tagen` };
  if (calendarDays <= DATE_DAYS) return { mode: "date", text: dateText(targetMs, toMs(end)) };
  const year = calendarDays > YEAR_AFTER_DAYS ? ` ${yearOf(targetMs)}` : "";
  return { mode: "month", text: `im ${monthName(targetMs)}${year}` };
}

/** Ist der Termin nah genug für einen Countdown (innerhalb der Schwelle)? */
export function isCountdownDue(target, { now = Date.now(), days = COUNTDOWN_DAYS_DEFAULT } = {}) {
  const targetMs = toMs(target);
  return Number.isFinite(targetMs) && targetMs > now && calendarDaysBetween(now, targetMs) <= countdownDays(days);
}

/**
 * Mit einem Verb davor: „startet in 3 Tagen“, „startet morgen 14:00“, „startet am Sa 14. November“, „startet im März“.
 * Ohne Verb wie `whenText` - nur das Datum bekommt kein „am“.
 */
export function whenPhrase(verb, when) {
  if (!when) return "";
  const text = when.mode === "date" ? `am ${when.text}` : when.text;
  return verb ? `${verb} ${text}` : (when.mode === "date" ? when.text : text);
}

/** Wie oft eine Anzeige nachsieht: in der letzten Stunde alle 15 Sekunden, sonst jede Minute. */
export function whenTickMs(target, now = Date.now()) {
  const diff = toMs(target) - now;
  if (!Number.isFinite(diff) || diff <= 0) return null;
  return diff < HOUR_MS ? 15 * 1000 : 60 * 1000;
}
