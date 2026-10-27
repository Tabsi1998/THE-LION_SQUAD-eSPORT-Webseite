// Drucktechniken von Printful (#2091): deutscher Name und kurze Erklärung - an genau dieser Stelle. Printful liefert nur
// Schlüssel (`dtg`, `dtfilm`, `embroidery` …); ein unbekannter Schlüssel bleibt als Name stehen, ohne Erklärung.
// Die Vorgabe beim Einrichten: was Printful als Standard meldet, sonst die erste aus PREFERRED.

export const TECHNIQUES = {
  dtg: { label: "DTG-Direktdruck", hint: "Fein und farbig, ideal für helle Shirts." },
  dtfilm: { label: "DTF-Transfer (DTFlex)", hint: "Kräftig und haltbar, auch auf dunklen Shirts." },
  dtf: { label: "DTF-Transfer", hint: "Kräftig und haltbar, auch auf dunklen Shirts." },
  embroidery: { label: "Stickerei", hint: "Gestickt, nur kleine Flächen (z. B. Brust)." },
  sublimation: { label: "Sublimationsdruck", hint: "Farbe zieht in den Stoff ein - nur helle Polyester-Ware." },
  "cut-sew": { label: "Rundumdruck (Zuschnitt und Naht)", hint: "Stoff wird bedruckt und danach genäht - Motiv über die ganze Fläche." },
  uv: { label: "UV-Druck", hint: "Für harte Oberflächen wie Hüllen oder Flaschen." },
  digital: { label: "Digitaldruck", hint: "Für Tassen, Poster und andere Artikel ohne Stoff." },
  knitting: { label: "Strickmuster", hint: "Motiv wird eingestrickt - nur einfache Formen und wenige Farben." },
};

// Reihenfolge für die Vorgabe, wenn Printful keine nennt: Direktdruck zuerst (fein, günstig), dann Transfer, dann Stickerei.
export const PREFERRED = ["dtg", "dtfilm", "dtf", "embroidery"];

export function techniqueLabel(key) {
  return TECHNIQUES[key]?.label || String(key ?? "");
}

export function techniqueHint(key) {
  return TECHNIQUES[key]?.hint || "";
}

export function techniqueList(keys) {
  return (keys || []).map(techniqueLabel).join(", ");
}

// Die sinnvolle Vorgabe für ein Printful-Produkt: gespeicherte Wahl, sonst der Standard von Printful, sonst PREFERRED,
// sonst die erste angebotene Technik.
export function defaultTechnique(printful, saved = null) {
  const offered = printful?.techniques || [];
  if (saved && offered.includes(saved)) return saved;
  if (printful?.default_technique && offered.includes(printful.default_technique)) return printful.default_technique;
  return PREFERRED.find((key) => offered.includes(key)) || offered[0] || saved || "";
}
