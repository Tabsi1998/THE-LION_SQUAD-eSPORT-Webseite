// Datum und Uhrzeit so, wie sie in Wien gelten (#943): „Jänner“ statt „Januar“, und ein Event um 19 Uhr steht auch
// auf einem Handy im Ausland als 19 Uhr da. Alle Datumsanzeigen der App laufen hier durch - direkte Aufrufe von
// toLocaleDateString/toLocaleTimeString meldet vienna.test.ts. Zahlen bleiben bei toLocaleString.
export const VIENNA_LOCALE = "de-AT";
export const VIENNA_ZONE = "Europe/Vienna";

type Moment = Date | string | number | null | undefined;

const asDate = (value: Date | string | number) => (value instanceof Date ? value : new Date(value));
const inVienna = (options?: Intl.DateTimeFormatOptions): Intl.DateTimeFormatOptions => ({ timeZone: VIENNA_ZONE, ...options });

/** Nur das Datum. Ohne Wert kommt ein leerer Text zurück. */
export function viennaDate(value: Moment, options?: Intl.DateTimeFormatOptions): string {
  return value == null ? "" : asDate(value).toLocaleDateString(VIENNA_LOCALE, inVienna(options));
}

/** Nur die Uhrzeit. */
export function viennaTime(value: Moment, options?: Intl.DateTimeFormatOptions): string {
  return value == null ? "" : asDate(value).toLocaleTimeString(VIENNA_LOCALE, inVienna(options));
}

/** Datum und Uhrzeit - oder genau die Teile, die `options` nennt. */
export function viennaDateTime(value: Moment, options?: Intl.DateTimeFormatOptions): string {
  return value == null ? "" : asDate(value).toLocaleString(VIENNA_LOCALE, inVienna(options));
}
