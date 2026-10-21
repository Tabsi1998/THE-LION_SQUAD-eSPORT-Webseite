import { WEB_BASE_URL } from "./siteUrls";

// Flaggen je Termin externer Serien in der App (#1925, App-Teil in #1945): dieselben Länder, deutschen Namen und
// Seitenverhältnisse wie im Web (frontend/src/lib/countries.json und flagRatios.json - countryFlags.test.ts hält beide
// gleich). Das Land erkennt der Server (`country_code` je Termin); die SVG-Datei lädt die App von der eigenen Website
// (/assets/flags/<code>.svg, gemeinfrei, Quelle im README dort) - kein fremder Dienst, kein Emoji.

export const COUNTRIES: Record<string, string> = {
  AE: "Vereinigte Arabische Emirate", AR: "Argentinien", AT: "Österreich", AU: "Australien", AZ: "Aserbaidschan", BE: "Belgien",
  BH: "Bahrain", BR: "Brasilien", CA: "Kanada", CH: "Schweiz", CN: "China", CZ: "Tschechien", DE: "Deutschland", ES: "Spanien",
  FI: "Finnland", FR: "Frankreich", GB: "Großbritannien", HU: "Ungarn", ID: "Indonesien", IN: "Indien", IT: "Italien", JP: "Japan",
  KR: "Südkorea", MA: "Marokko", MC: "Monaco", MX: "Mexiko", MY: "Malaysia", NL: "Niederlande", NZ: "Neuseeland", PL: "Polen",
  PT: "Portugal", QA: "Katar", RU: "Russland", SA: "Saudi-Arabien", SE: "Schweden", SG: "Singapur", TH: "Thailand", TR: "Türkei",
  US: "USA", VN: "Vietnam", ZA: "Südafrika",
};

export const FLAG_RATIOS: Record<string, number> = {
  AE: 2, AR: 1.6, AT: 1.5, AU: 2, AZ: 2, BE: 1.154, BH: 1.667, BR: 1.429, CA: 2, CH: 1, CN: 1.5, CZ: 1.5, DE: 1.667, ES: 1.5,
  FI: 1.636, FR: 1.5, GB: 2, HU: 2, ID: 1.5, IN: 1.5, IT: 1.5, JP: 1.5, KR: 1.5, MA: 1.5, MC: 1.25, MX: 1.75, MY: 2, NL: 1.5,
  NZ: 2, PL: 1.6, PT: 1.5, QA: 2.545, RU: 1.5, SA: 1.5, SE: 1.6, SG: 1.5, TH: 1.5, TR: 1.5, US: 1.9, VN: 1.5, ZA: 1.5,
};

const MAX_RATIO = 2;

/** Der Code eines bekannten Landes in Großbuchstaben - sonst leer. */
export function countryCode(value: unknown): string {
  const code = String(value || "").trim().toUpperCase();
  return Object.prototype.hasOwnProperty.call(COUNTRIES, code) ? code : "";
}

/** Deutscher Name eines Landes („Aserbaidschan“) - leer, wenn der Code unbekannt ist. */
export function countryName(value: unknown): string {
  const code = countryCode(value);
  return code ? COUNTRIES[code] : "";
}

/** Adresse der Flagge auf der eigenen Website - `null` ohne bekanntes Land. */
export function flagUrl(value: unknown): string | null {
  const code = countryCode(value);
  return code ? `${WEB_BASE_URL}/assets/flags/${code.toLowerCase()}.svg` : null;
}

/** Fester Kasten einer Flagge: gleiche Höhe, Breite nach dem echten Seitenverhältnis bis höchstens 2:1. */
export function flagBox(value: unknown, height: number): { width: number; height: number } {
  const ratio = FLAG_RATIOS[countryCode(value)] || 1.5;
  return { width: Math.round(height * Math.min(ratio, MAX_RATIO)), height };
}
