// Datum und Uhrzeit so, wie sie in Wien gelten (#943): „Jänner“ statt „Januar“, und ein Event um 19 Uhr steht auch
// für Besucher im Ausland als 19 Uhr da. Alle Datumsanzeigen laufen hier durch - direkte Aufrufe von
// toLocaleDateString/toLocaleTimeString meldet vienna.test.js. Zahlen bleiben bei toLocaleString.
export const VIENNA_LOCALE = "de-AT";
export const VIENNA_ZONE = "Europe/Vienna";

const asDate = (value) => (value instanceof Date ? value : new Date(value));
const inVienna = (options) => ({ timeZone: VIENNA_ZONE, ...options });

/** Nur das Datum. Ohne Wert kommt nichts zurück - wie bei `wert?.toLocaleDateString()`. */
export function viennaDate(value, options) {
  return value == null ? undefined : asDate(value).toLocaleDateString(VIENNA_LOCALE, inVienna(options));
}

/** Nur die Uhrzeit. */
export function viennaTime(value, options) {
  return value == null ? undefined : asDate(value).toLocaleTimeString(VIENNA_LOCALE, inVienna(options));
}

/** Datum und Uhrzeit - oder genau die Teile, die `options` nennt. */
export function viennaDateTime(value, options) {
  return value == null ? undefined : asDate(value).toLocaleString(VIENNA_LOCALE, inVienna(options));
}
