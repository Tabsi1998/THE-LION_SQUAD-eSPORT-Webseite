// Flagge je Termin externer Serien (#1925): deutscher Name und eigene Flaggen-Datei je Land. Das Land selbst erkennt der
// Server aus Ort bzw. Strecke (services/round_countries.py) - hier wird nur benannt und die Auswahl im Termin gebaut.
// Die Flaggen liegen als SVG-Dateien unter public/assets/flags (gemeinfrei, Quelle im README dort; kein fremder Dienst,
// kein Emoji); dieselbe Liste der Länder und das Seitenverhältnis je Flagge (flagRatios.json) hält ein Backend-Test mit
// Server und Dateien gleich.
import COUNTRIES from "@/lib/countries.json";
import RATIOS from "@/lib/flagRatios.json";

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

/** Seitenverhältnis der Flagge (Breite durch Höhe), etwa 1 für die Schweiz und 2 für Großbritannien - sonst 3:2. */
export function flagRatio(value) {
  return RATIOS[codeOf(value)] || 1.5;
}

/** Auswahl im Termin: `[Code, Name]`, nach deutschem Namen (Umlaute wie ihr Grundbuchstabe). */
export const COUNTRY_OPTIONS = Object.entries(COUNTRIES)
  .sort(([, left], [, right]) => left.localeCompare(right, "de", { sensitivity: "base" }));
