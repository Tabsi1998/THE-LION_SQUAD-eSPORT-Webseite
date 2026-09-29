// Adventkalenderrechnung (S6, #637): dieselbe Rechnung wie im Server (backend/services/seasons.py) - der Server
// bleibt die Quelle der Wahrheit (`data.candles`, `data.sundays`, `data.days_to_christmas`); hier nur der Rückfall
// (Vorschau, alte Antwort) und die Tage seit dem Anzünden je Kerze für Docht und Wachs. Alle Tage als ISO-Datum
// (JJJJ-MM-TT), gerechnet in UTC-Tagen, damit die Zeitumstellung nichts verschiebt.

const DAY_MS = 24 * 60 * 60 * 1000;

function utcDay(iso) {
  const [year, month, day] = String(iso).slice(0, 10).split("-").map(Number);
  return Date.UTC(year, month - 1, day);
}

function isoOf(utcMs) {
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** Der 4. Advent: der letzte Sonntag vor oder am 24. Dezember. */
export function fourthAdvent(year) {
  const eve = Date.UTC(year, 11, 24);
  return isoOf(eve - new Date(eve).getUTCDay() * DAY_MS);
}

/** Der 1. Advent: drei Wochen vor dem vierten. */
export function firstAdvent(year) {
  return isoOf(utcDay(fourthAdvent(year)) - 21 * DAY_MS);
}

/** Die vier Adventsonntage eines Jahres. */
export function adventSundays(year) {
  const first = utcDay(firstAdvent(year));
  return [0, 1, 2, 3].map((week) => isoOf(first + week * 7 * DAY_MS));
}

/** Wie viele Kerzen an einem Tag brennen: eine je Adventsonntag, der schon war. */
export function candlesLit(day, sundays = adventSundays(Number(String(day).slice(0, 4)))) {
  return sundays.filter((sunday) => sunday <= String(day).slice(0, 10)).length;
}

/** Tage bis Heiligabend (nie negativ). */
export function daysToChristmas(day, year = Number(String(day).slice(0, 4))) {
  return Math.max(0, Math.round((Date.UTC(year, 11, 24) - utcDay(day)) / DAY_MS));
}

/** Volle Tage von `from` bis `day` (nie negativ). */
export function daysSince(from, day) {
  return Math.max(0, Math.round((utcDay(day) - utcDay(from)) / DAY_MS));
}

/** Der heutige Tag des Geräts als ISO-Datum (Ortszeit - der Server rechnet in Wien, die Anzeige folgt der Uhr der Person). */
export function todayIso(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}
