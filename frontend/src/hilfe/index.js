import konto from "./themen/konto-und-profil.json";
import team from "./themen/team-und-co-team.json";
import liga from "./themen/liga-captains.json";
import turniere from "./themen/turniere.json";
import masse from "./bilder/masse.json";
import bereiche from "./bereiche.json";
import fragen from "./fragen.json";
import { fragePfad, hilfePfad } from "./pfade";

export { FAQ_PFAD, fragePfad, hilfePfad, hilfeUmleitung } from "./pfade";

// FAQ (#2448, vorher Hilfe #2295): Fragen und Anleitungen unter /faq, eine Anleitung unter /faq/<thema>. Ein Thema ist eine
// JSON-Datei in ./themen (Abschnitte mit Schritten: kurzer Satz, optional Hinweis und Link). Die Bilder je Schritt
// (Handy 390 px, PC 1440 px) und die kurzen Videos erzeugt e2e/hilfe-bilder.spec.js mit nachgestellter API; sie liegen
// in ./bilder/<thema>/<schritt>-handy|pc.webp und ./videos/<id>.webm. Dieselben Texte soll später die geführte Tour
// (#2296) nutzen - deshalb Daten statt fest geschriebener Seiten.
//
// Inhaltsmodell (#2448): Jede Frage (fragen.json) und jedes Thema trägt `bereich` (bereiche.json), `rollen` für den
// Filter (spieler, captain, mitglied, turnierleitung) und `sichtbar_fuer` (alle, angemeldet, mitglied, turnierleitung).
// Hier im öffentlichen Bundle steht nur `alle`; Geschütztes liefert der Server nach Rechteprüfung (GET /api/faq,
// backend/services/faq_protected.py). Ein Abschnitt kann mit eigenem `bereich` zusätzlich in einem zweiten Bereich stehen.

export const THEMEN = [konto, team, liga, turniere];
// Gleich lautend in backend/services/help_topics.py (Teilen-Karte für Discord und WhatsApp).
export const HILFE_BESCHREIBUNG = "Häufige Fragen und kurze Anleitungen mit Bildern: Konto und Profil, Teams, Liga, Turniere und mehr.";
export const BEREICHE = bereiche;
/** Öffentliche Fragen - nur `sichtbar_fuer: alle` (Wächtertest in index.test.js). */
export const FRAGEN = fragen;
export const ROLLEN = [
  { id: "spieler", label: "Spieler" },
  { id: "captain", label: "Captain" },
  { id: "mitglied", label: "Mitglied" },
  { id: "turnierleitung", label: "Turnierleitung" },
];
export const SICHTBARKEITEN = ["alle", "angemeldet", "mitglied", "turnierleitung", "turnierleitung_verwaltung"];

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

/** Darf jemand eine Stufe sehen? `darf` kommt vom Server (GET /api/faq). Unbekannte Stufen bleiben zu. */
export function darfSehen(sichtbar, darf = {}) {
  if (!sichtbar || sichtbar === "alle") return true;
  return SICHTBARKEITEN.includes(sichtbar) && Boolean(darf?.[sichtbar]);
}

/** Ohne Rolle passt alles; sonst muss die Rolle im Eintrag stehen. */
export function passtZuRolle(eintrag, rolle) {
  return !rolle || (eintrag?.rollen || []).includes(rolle);
}

/** Die Rollen-Chips, die jemand sieht: Turnierleitung nur mit Leitungsrechten. */
export function sichtbareRollen(darf = {}) {
  return ROLLEN.filter((rolle) => rolle.id !== "turnierleitung" || darf?.turnierleitung);
}

export function faqBereich(id, bereiche = BEREICHE) {
  return bereiche.find((bereich) => bereich.id === id) || null;
}

/** Die Bereiche, die jemand sieht - geschützte nur mit Recht - und die zur gewählten Rolle passen. */
export function sichtbareBereiche({ darf = {}, rolle = "", bereiche = BEREICHE } = {}) {
  return bereiche.filter((bereich) => darfSehen(bereich.sichtbar_fuer, darf) && passtZuRolle(bereich, rolle));
}

/**
 * Was in einem Bereich steht: Anleitungen (ganzes Thema oder ein Abschnitt mit eigenem `bereich`) und Fragen, jeweils
 * nur, was jemand sehen darf und was zur Rolle passt.
 */
export function bereichInhalt(bereichId, { fragen = FRAGEN, themen = THEMEN, rolle = "", darf = {} } = {}) {
  const anleitungen = [];
  for (const thema of themen) {
    if (!darfSehen(thema.sichtbar_fuer, darf) || !passtZuRolle(thema, rolle)) continue;
    if (thema.bereich === bereichId) anleitungen.push({ thema, abschnitt: null });
    for (const abschnitt of thema.abschnitte || []) {
      if (abschnitt.bereich === bereichId && thema.bereich !== bereichId) anleitungen.push({ thema, abschnitt });
    }
  }
  const passende = fragen.filter((frage) => frage.bereich === bereichId && darfSehen(frage.sichtbar_fuer, darf) && passtZuRolle(frage, rolle));
  return { anleitungen, fragen: passende, leer: !anleitungen.length && !passende.length };
}

/**
 * Die Bereichsliste der Seite: sichtbare Bereiche samt Inhalt. Ohne Rollen-Filter steht ein leerer Bereich als „Kommt
 * bald“ da; mit Filter fällt er weg - leer nur wegen des Filters ist kein „bald“ (#2448, Review F4).
 */
export function faqBereichsliste({ fragen = FRAGEN, themen = THEMEN, rolle = "", darf = {}, bereiche = BEREICHE } = {}) {
  return sichtbareBereiche({ darf, rolle, bereiche })
    .map((bereich) => ({ bereich, inhalt: bereichInhalt(bereich.id, { fragen, themen, rolle, darf }) }))
    .filter(({ inhalt }) => !rolle || !inhalt.leer);
}

/** „Häufige Fragen“: markierte Fragen, die jemand sehen darf und die zur Rolle passen. */
export function haeufigeFragen({ fragen = FRAGEN, rolle = "", darf = {} } = {}) {
  return fragen.filter((frage) => frage.haeufig && darfSehen(frage.sichtbar_fuer, darf) && passtZuRolle(frage, rolle));
}

/** Bereich eines Schritts: der des Abschnitts, sonst der des Themas. */
export function schrittBereich(thema, schritt) {
  return schritt?.abschnitt?.bereich || thema?.bereich || "";
}

/**
 * Suche über Fragen und Schritte (#2448): jedes Wort muss vorkommen. Fragen zählen im Fragetext mehr, Schritte wie
 * bisher (sucheHilfe). Jeder Treffer nennt seinen Bereich und seine Adresse; beste zuerst, höchstens `limit`.
 */
export function sucheFaq(anfrage, { fragen = FRAGEN, themen = THEMEN, darf = {}, limit = 12 } = {}) {
  const woerter = hilfeNormal(anfrage).split(" ").filter((wort) => wort.length > 1);
  if (!woerter.length) return [];
  const treffer = [];
  for (const frage of fragen) {
    if (!darfSehen(frage.sichtbar_fuer, darf)) continue;
    const titel = hilfeNormal(frage.frage);
    const text = hilfeNormal(frage.antwort);
    const bereichText = hilfeNormal(faqBereich(frage.bereich)?.titel);
    let punkte = 0;
    let alle = true;
    for (const wort of woerter) {
      if (titel.includes(wort)) punkte += 6;
      else if (text.includes(wort)) punkte += 2;
      else if (bereichText.includes(wort)) punkte += 1;
      else { alle = false; break; }
    }
    if (alle) treffer.push({ art: "frage", id: frage.id, titel: frage.frage, text: frage.antwort, bereich: frage.bereich, to: fragePfad(frage.id), punkte, reihe: 0 });
  }
  const sichtbareThemen = themen.filter((thema) => darfSehen(thema.sichtbar_fuer, darf));
  for (const { thema, schritt, punkte } of sucheHilfe(anfrage, { themen: sichtbareThemen, limit: Number.MAX_SAFE_INTEGER })) {
    treffer.push({
      art: "schritt", id: `${thema.slug}-${schritt.id}`, titel: schritt.titel, text: schritt.text, bereich: schrittBereich(thema, schritt),
      thema, to: hilfePfad(thema.slug, schritt.id), punkte, reihe: schritt.nummer,
    });
  }
  // Steht jedes Wort bei einigen Treffern im Text selbst, fallen die weg, die nur über Thema oder Bereich passen - sonst
  // füllt „einchecken“ die Liste mit jedem Schritt der Liga.
  const imText = woerter.length * 2;
  const starke = treffer.some((row) => row.punkte >= imText) ? treffer.filter((row) => row.punkte >= imText) : treffer;
  return starke.sort((a, b) => b.punkte - a.punkte || (a.art === b.art ? a.reihe - b.reihe : a.art === "frage" ? -1 : 1)).slice(0, limit);
}
