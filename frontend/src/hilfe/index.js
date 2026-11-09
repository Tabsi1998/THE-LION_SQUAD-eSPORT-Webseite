import konto from "./themen/konto-und-profil.json";
import team from "./themen/team-und-co-team.json";
import liga from "./themen/liga-captains.json";
import turniere from "./themen/turniere.json";
import masse from "./bilder/masse.json";

// Hilfe-Bereich (#2295): Anleitungen für Spieler und Captains unter /hilfe und /hilfe/<thema>. Ein Thema ist eine
// JSON-Datei in ./themen (Abschnitte mit Schritten: kurzer Satz, optional Hinweis und Link). Die Bilder je Schritt
// (Handy 390 px, PC 1440 px) und die kurzen Videos erzeugt e2e/hilfe-bilder.spec.js mit nachgestellter API; sie liegen
// in ./bilder/<thema>/<schritt>-handy|pc.webp und ./videos/<id>.webm. Dieselben Texte soll später die geführte Tour
// (#2296) nutzen - deshalb Daten statt fest geschriebener Seiten.

export const THEMEN = [konto, team, liga, turniere];
// Gleich lautend in backend/services/help_topics.py (Teilen-Karte für Discord und WhatsApp).
export const HILFE_BESCHREIBUNG = "Kurze Anleitungen mit Bildern für Spieler und Captains: Konto und Profil, Team und Co-Team, Liga, Turniere.";

const BILDER = import.meta.glob("./bilder/**/*.webp", { eager: true, query: "?url", import: "default" });
const VIDEOS = import.meta.glob("./videos/*.webm", { eager: true, query: "?url", import: "default" });
export const FORMEN = ["handy", "pc"];

export function hilfeThema(slug) {
  return THEMEN.find((thema) => thema.slug === slug) || null;
}

/** Alle Schritte eines Themas der Reihe nach, mit Nummer und Abschnitt. */
export function hilfeSchritte(thema) {
  let nummer = 0;
  return (thema?.abschnitte || []).flatMap((abschnitt) => abschnitt.schritte.map((schritt) => ({ ...schritt, nummer: ++nummer, abschnitt })));
}

export function hilfePfad(slug, schrittId = "") {
  return schrittId ? `/hilfe/${slug}#${schrittId}` : `/hilfe/${slug}`;
}

/** Bild eines Schritts für `handy` oder `pc`: Adresse mit Breite und Höhe (gegen Springen beim Laden), sonst null. */
export function hilfeBild(slug, schrittId, form, bilder = BILDER, groessen = masse) {
  const key = `${slug}/${schrittId}-${form}`;
  const src = bilder[`./bilder/${key}.webp`];
  if (!src) return null;
  const [width, height] = groessen[key] || [];
  return { src, width: width || undefined, height: height || undefined };
}

export function hilfeVideo(id, videos = VIDEOS) {
  return videos[`./videos/${id}.webm`] || null;
}

/** Klein, ohne Akzente, Umlaute ausgeschrieben - so findet ein Wort mit Umlaut auch die Schreibweise mit ae, oe, ue. */
export function hilfeNormal(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

/**
 * Suche über alle Themen: jedes Wort der Anfrage muss vorkommen (Titel, Text, Hinweis, Abschnitt, Thema, Suchbegriffe).
 * Treffer im Schritt-Titel zählen mehr. Ergebnis: Schritte mit Thema, beste zuerst, höchstens `limit`.
 */
export function sucheHilfe(anfrage, { themen = THEMEN, limit = 12 } = {}) {
  const woerter = hilfeNormal(anfrage).split(" ").filter((wort) => wort.length > 1);
  if (!woerter.length) return [];
  const treffer = [];
  for (const thema of themen) {
    const themaText = hilfeNormal([thema.titel, thema.kurz, ...(thema.suchbegriffe || [])].join(" "));
    for (const schritt of hilfeSchritte(thema)) {
      const titel = hilfeNormal(schritt.titel);
      const text = hilfeNormal([schritt.text, schritt.hinweis, schritt.abschnitt.titel].join(" "));
      let punkte = 0;
      let alle = true;
      for (const wort of woerter) {
        if (titel.includes(wort)) punkte += 5;
        else if (text.includes(wort)) punkte += 2;
        else if (themaText.includes(wort)) punkte += 1;
        else { alle = false; break; }
      }
      if (alle) treffer.push({ thema, schritt, punkte });
    }
  }
  return treffer.sort((a, b) => b.punkte - a.punkte || a.schritt.nummer - b.schritt.nummer).slice(0, limit);
}
