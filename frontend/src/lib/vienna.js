// Datum und Uhrzeit so, wie sie in Wien gelten (#943): „Jänner“ statt „Januar“, und ein Event um 19 Uhr steht auch
// für Besucher im Ausland als 19 Uhr da. Alle Datumsanzeigen laufen hier durch - direkte Aufrufe von
// toLocaleDateString/toLocaleTimeString meldet vienna.test.js. Zahlen bleiben bei toLocaleString.
// Die Hilfen nehmen den Wert vom Server, wie er kommt (Text, Zahl oder Date) - siehe asInstant.
export const VIENNA_LOCALE = "de-AT";
export const VIENNA_ZONE = "Europe/Vienna";

const inVienna = (options) => ({ timeZone: VIENNA_ZONE, ...options });

// ---------------------------------------------------------------- Werte vom Server
// Eine Zeitangabe ohne Zone („2026-08-01T00:00:00“, etwa das Datum eines Albums) meint die Wiener Uhr - so hat sie
// der Verein eingetragen. Der Browser läse sie als Zeit des Geräts, und im Ausland verrutschten Uhrzeit und Tag.
const CLOCK = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?$/;
let clockFormat;

// Wie weit die Wiener Uhr zu diesem Zeitpunkt vor UTC liegt: im Winter eine Stunde, im Sommer zwei.
function viennaOffset(time) {
  clockFormat = clockFormat || new Intl.DateTimeFormat(VIENNA_LOCALE, {
    timeZone: VIENNA_ZONE, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
  });
  const parts = {};
  for (const part of clockFormat.formatToParts(new Date(time))) parts[part.type] = Number(part.value);
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second) - time;
}

/**
 * Ein Wert vom Server als Zeitpunkt: mit Zone so, wie er dasteht; ohne Zone als Wiener Uhr. Ein reines Datum
 * („2026-12-31“) bleibt Mitternacht UTC - das ist in Wien derselbe Tag. Wer einen Serverwert für die Anzeige
 * liest, nimmt diese Hilfe statt `new Date(wert)`.
 */
export function asInstant(value) {
  if (value instanceof Date) return value;
  const clock = typeof value === "string" ? CLOCK.exec(value.trim()) : null;
  if (!clock) return new Date(value);
  const wall = Date.UTC(Number(clock[1]), Number(clock[2]) - 1, Number(clock[3]), Number(clock[4]), Number(clock[5]), Number(clock[6] || 0));
  // Zweimal gerechnet: Der erste Wurf liegt rund um die Zeitumstellung eine Stunde daneben.
  const instant = wall - viennaOffset(wall - viennaOffset(wall));
  return new Date(Number.isNaN(instant) ? value : instant);
}

// ---------------------------------------------------------------- Eingabefelder (datetime-local)
// Ein Feld „Datum und Uhrzeit“ zeigt die Wiener Uhr, egal, in welcher Zone das Gerät steht (#1557). Zeitumstellung
// wie Temporal „compatible“: eine Uhrzeit, die es nicht gibt (letzter Sonntag im März, 02:00–02:59), rückt um die
// fehlende Stunde vor; eine Uhrzeit, die es zweimal gibt (letzter Sonntag im Oktober, 02:00–02:59), meint die erste.
const HOUR_MS = 60 * 60 * 1000;
let inputFormat;

/** Ein Zeitpunkt als Wert für ein datetime-local-Feld („JJJJ-MM-TTTHH:MM“) in Wiener Uhr - leer ohne gültigen Wert. */
export function viennaInputValue(value) {
  if (value == null || value === "") return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  inputFormat = inputFormat || new Intl.DateTimeFormat("en-CA", {
    timeZone: VIENNA_ZONE, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  });
  const parts = {};
  for (const part of inputFormat.formatToParts(date)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}T${String(Number(parts.hour) % 24).padStart(2, "0")}:${parts.minute}`;
}

/** Ein datetime-local-Feld, gelesen als Wiener Uhr, als ISO-Zeitpunkt (UTC) - null ohne gültigen Wert. */
export function fromViennaInput(text) {
  const clock = typeof text === "string" ? CLOCK.exec(text.trim()) : null;
  if (!clock) return null;
  const wall = Date.UTC(Number(clock[1]), Number(clock[2]) - 1, Number(clock[3]), Number(clock[4]), Number(clock[5]), Number(clock[6] || 0));
  if (Number.isNaN(wall)) return null;
  // Die Abstände zu UTC vor und nach einer möglichen Umstellung; gültig ist, was in Wien wieder genau diese Uhr zeigt.
  const before = viennaOffset(wall - 3 * HOUR_MS);
  const after = viennaOffset(wall + 3 * HOUR_MS);
  const fits = [wall - before, wall - after].filter((instant) => viennaOffset(instant) === wall - instant);
  // Doppelte Stunde: zwei passen, die erste gilt. Lücke: keiner passt, mit dem Abstand davor rückt die Uhr vor.
  const instant = fits.length ? Math.min(...fits) : wall - before;
  return new Date(instant).toISOString();
}

/** Nur das Datum. Ohne Wert kommt nichts zurück - wie bei `wert?.toLocaleDateString()`. */
export function viennaDate(value, options) {
  return value == null ? undefined : asInstant(value).toLocaleDateString(VIENNA_LOCALE, inVienna(options));
}

/** Nur die Uhrzeit. */
export function viennaTime(value, options) {
  return value == null ? undefined : asInstant(value).toLocaleTimeString(VIENNA_LOCALE, inVienna(options));
}

/** Datum und Uhrzeit - oder genau die Teile, die `options` nennt. */
export function viennaDateTime(value, options) {
  return value == null ? undefined : asInstant(value).toLocaleString(VIENNA_LOCALE, inVienna(options));
}

// ---------------------------------------------------------------- Tage
// Wer Wiener Uhrzeiten zeigt, zählt auch die Tage in Wien: „Heute“, „Gestern“ und der Kalender vergleichen diesen
// Tag - nie den des Geräts. Sonst steht im Ausland neben „19:00“ der falsche Tag, und ein Test hängt an der Zone
// des Prüfrechners.
const DAY_MS = 24 * 60 * 60 * 1000;
let dayFormat;

/** Der Kalendertag in Wien als „JJJJ-MM-TT“. Ohne gültigen Wert kommt ein leerer Text. */
export function viennaDay(value) {
  if (value == null) return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  // Die Teile einzeln - so ist egal, wie die Laufzeit ein Datum im Ganzen schreibt.
  dayFormat = dayFormat || new Intl.DateTimeFormat("en-CA", { timeZone: VIENNA_ZONE, year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = {};
  for (const part of dayFormat.formatToParts(date)) parts[part.type] = part.value;
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/** Ein Kalendertag („JJJJ-MM-TT“) als Zeitpunkt: sein Mittag - der liegt in Wien sicher an diesem Tag. Zum Beschriften. */
export function dayNoon(day) {
  const [year, month, date] = String(day).split("-").map(Number);
  return new Date(Date.UTC(year, (month || 1) - 1, date || 1, 12));
}

/** Der Tag davor - am Kalender gezählt, nicht 24 Stunden zurück: Die Zeitumstellung macht Tage mit 23 und 25 Stunden. */
export function dayBefore(day) {
  return new Date(dayNoon(day).getTime() - DAY_MS).toISOString().slice(0, 10);
}
