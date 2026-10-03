import { pointFree } from "./snow/WinterSky";

// Freier Platz für Deko, die an Kanten hängt (Luftschlangen am Fasching #746, Wimpelketten am Vereinsgeburtstag #750):
// keine Schrift, kein Bild, kein Bedienelement - und auch kein Kasten (Chip, Karte, Rahmen). Was dort liegt, muss fast
// so breit sein wie die Seite (Abschnitt, Hintergrund).

export function openSpot(doc, x, y, pageWidth) {
  if (!pointFree(doc, x, y)) return false;
  const node = typeof doc.elementFromPoint === "function" ? doc.elementFromPoint(x, y) : null;
  if (!node || node === doc.body || node === doc.documentElement) return true;
  return node.getBoundingClientRect().width >= pageWidth * 0.85;
}
