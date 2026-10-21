// Flagge je Termin externer Serien (#1925): deutscher Name und eigene Flaggen-Datei je Land. Das Land selbst erkennt der
// Server aus Ort bzw. Strecke (services/round_countries.py) - hier wird nur benannt und die Auswahl im Termin gebaut.
// Die Flaggen liegen als eigene SVG-Dateien unter public/assets/flags (kein fremder Dienst, kein Emoji); dieselbe Liste
// der Länder hält ein Backend-Test mit dem Server gleich.
import COUNTRIES from "@/lib/countries.json";

function codeOf(value) {
  const code = String(value || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(COUNTRIES, code) ? code : "";
}

/** Deutscher Name eines Landes („Aserbaidschan“) - leer, wenn der Code unbekannt ist. */
export function countryName(value) {
  const code = codeOf(value);
  return code ? COUNTRIES[code] : "";
}

/** Adresse der Flagge - `null` ohne bekanntes Land. */
export function flagSrc(value) {
  const code = codeOf(value);
  return code ? `/assets/flags/${code.toLowerCase()}.svg` : null;
}

/** Auswahl im Termin: `[Code, Name]`, nach deutschem Namen (Umlaute wie ihr Grundbuchstabe). */
export const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .sort(([, left], [, right]) => left.localeCompare(right, "de", { sensitivity: "base" }));
