import { APP_BEREICH, APP_FRAGEN } from "./appFragen";
import type { FaqBereich, FaqDarf, FaqFrage, FaqSchritt, FaqAbschnitt, FaqThema } from "./types";
import WEB from "./webFaq.generated.json";

export type * from "./types";

// FAQ in der App (#2449) - dieselben Regeln wie die FAQ der Website (frontend/src/hilfe/index.js, #2448): Suche über
// Fragen und Schritte, Sichtbarkeit nach dem, was der Server erlaubt, Rollen-Filter und die Liste der Bereiche.
// Öffentliche Fragen und Anleitungen kommen als gebündelte Kopie aus dem Web (webFaq.generated.json, scripts/sync-faq.js),
// Mitglieder- und Leitungsfragen nur vom Server (GET /api/faq, useFaqZugang). Vorne steht der App-eigene Bereich
// „LionsAPP“ (appFragen.ts).

const WEB_BEREICHE: FaqBereich[] = WEB.bereiche;
const WEB_FRAGEN: FaqFrage[] = WEB.fragen;
const WEB_THEMEN: FaqThema[] = WEB.themen;

export const FAQ_PFAD = "/faq";
export const BEREICHE: FaqBereich[] = [APP_BEREICH, ...WEB_BEREICHE];
/** Öffentliche Fragen: die der App zuerst, dann die des Webs - nur solche, die jeder sehen darf (Wächtertest in faq.test.ts). */
export const FRAGEN: FaqFrage[] = [...APP_FRAGEN, ...WEB_FRAGEN];
export const THEMEN: FaqThema[] = WEB_THEMEN;
export const ROLLEN = [
  { id: "spieler", label: "Spieler" },
  { id: "captain", label: "Captain" },
  { id: "mitglied", label: "Mitglied" },
  { id: "turnierleitung", label: "Turnierleitung" },
];
export const SICHTBARKEITEN = ["alle", "angemeldet", "mitglied", "turnierleitung", "turnierleitung_verwaltung"];
export const OHNE_ZUGANG: FaqDarf = Object.freeze({ angemeldet: false, mitglied: false, turnierleitung: false, turnierleitung_verwaltung: false });

/** Adresse einer Anleitung im Web: /faq/<thema>, ein Schritt oder Abschnitt mit Anker - wie hilfePfad im Web. */
export function hilfePfad(slug: string, anker = ""): string {
  return anker ? `${FAQ_PFAD}/${slug}#${anker}` : `${FAQ_PFAD}/${slug}`;
}

export type FaqSchrittMitNummer = FaqSchritt & { nummer: number; abschnitt: FaqAbschnitt };

/** Alle Schritte eines Themas der Reihenfolge nach, mit Nummer und Abschnitt. */
export function hilfeSchritte(thema: FaqThema | null | undefined): FaqSchrittMitNummer[] {
  let nummer = 0;
  return (thema?.abschnitte || []).flatMap((abschnitt) => abschnitt.schritte.map((schritt) => ({ ...schritt, nummer: ++nummer, abschnitt })));
}

/** Klein, ohne Akzente, Umlaute ausgeschrieben - so findet ein Wort mit Umlaut auch die Schreibweise mit ae, oe, ue. */
export function hilfeNormal(text: unknown): string {
  // Zuerst NFC: Ein zerlegtes „ä“ (a + Trema, etwa aus kopiertem Text) wird so zu „ä“ und damit zu „ae“.
  return String(text || "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9#]+/g, " ")
    .trim();
}

function suchWoerter(anfrage: string): string[] {
  return hilfeNormal(anfrage).split(" ").filter((wort) => wort.length > 1);
}

/** Darf jemand eine Stufe sehen? `darf` kommt vom Server (GET /api/faq). Unbekannte Stufen bleiben zu. */
export function darfSehen(sichtbar: string | undefined, darf: Partial<FaqDarf> = {}): boolean {
  if (!sichtbar || sichtbar === "alle") return true;
  return SICHTBARKEITEN.includes(sichtbar) && Boolean(darf?.[sichtbar as keyof FaqDarf]);
}

/** Ohne Rolle passt alles; sonst muss die Rolle im Eintrag stehen. */
export function passtZuRolle(eintrag: { rollen?: string[] } | null | undefined, rolle: string): boolean {
  return !rolle || (eintrag?.rollen || []).includes(rolle);
}

/** Die Rollen-Chips, die jemand sieht: Turnierleitung nur mit Leitungsrechten. */
export function sichtbareRollen(darf: Partial<FaqDarf> = {}) {
  return ROLLEN.filter((rolle) => rolle.id !== "turnierleitung" || darf?.turnierleitung);
}

export function faqBereich(id: string, bereiche: FaqBereich[] = BEREICHE): FaqBereich | null {
  return bereiche.find((bereich) => bereich.id === id) || null;
}

type Auswahl = { fragen?: FaqFrage[]; themen?: FaqThema[]; rolle?: string; darf?: Partial<FaqDarf>; bereiche?: FaqBereich[] };

export type FaqAnleitung = { thema: FaqThema; abschnitt: FaqAbschnitt | null };
export type FaqBereichInhalt = { anleitungen: FaqAnleitung[]; fragen: FaqFrage[]; leer: boolean };

/** Was in einem Bereich steht: Anleitungen und Fragen, jeweils nur, was jemand sehen darf und was zur Rolle passt. */
export function bereichInhalt(bereichId: string, { fragen = FRAGEN, themen = THEMEN, rolle = "", darf = {} }: Auswahl = {}): FaqBereichInhalt {
  const anleitungen: FaqAnleitung[] = [];
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
 * Die Bereichsliste: sichtbare Bereiche (geschützte nur mit Recht), die zur Rolle passen, samt Inhalt. Ohne Rollen-Filter
 * steht ein leerer Bereich als „Kommt bald“ da; mit Filter fällt er weg - wie im Web.
 */
export function faqBereichsliste({ fragen = FRAGEN, themen = THEMEN, rolle = "", darf = {}, bereiche = BEREICHE }: Auswahl = {}) {
  return bereiche
    .filter((bereich) => darfSehen(bereich.sichtbar_fuer, darf) && passtZuRolle(bereich, rolle))
    .map((bereich) => ({ bereich, inhalt: bereichInhalt(bereich.id, { fragen, themen, rolle, darf }) }))
    .filter(({ inhalt }) => !rolle || !inhalt.leer);
}

/** „Häufige Fragen“: markierte Fragen, die jemand sehen darf und die zur Rolle passen. */
export function haeufigeFragen({ fragen = FRAGEN, rolle = "", darf = {} }: Auswahl = {}): FaqFrage[] {
  return fragen.filter((frage) => frage.haeufig && darfSehen(frage.sichtbar_fuer, darf) && passtZuRolle(frage, rolle));
}

export type FaqTreffer =
  | { art: "frage"; id: string; titel: string; text: string; bereich: string; frage: FaqFrage; punkte: number; reihe: number }
  | { art: "schritt"; id: string; titel: string; text: string; bereich: string; thema: FaqThema; to: string; punkte: number; reihe: number };

/**
 * Suche über Fragen und Schritte - dieselbe Wertung wie sucheFaq im Web: jedes Wort muss vorkommen; Fragen zählen im
 * Fragetext mehr, Schritte im Titel. Steht jedes Wort bei einigen Treffern im Text selbst, fallen die weg, die nur über
 * Thema oder Bereich passen. Beste zuerst, höchstens `limit`.
 */
export function sucheFaq(anfrage: string, { fragen = FRAGEN, themen = THEMEN, darf = {}, bereiche = BEREICHE, limit = 12 }: Auswahl & { limit?: number } = {}): FaqTreffer[] {
  const woerter = suchWoerter(anfrage);
  if (!woerter.length) return [];
  const treffer: FaqTreffer[] = [];
  for (const frage of fragen) {
    if (!darfSehen(frage.sichtbar_fuer, darf)) continue;
    const titel = hilfeNormal(frage.frage);
    const text = hilfeNormal(frage.antwort);
    const bereichText = hilfeNormal(faqBereich(frage.bereich, bereiche)?.titel);
    let punkte = 0;
    let alle = true;
    for (const wort of woerter) {
      if (titel.includes(wort)) punkte += 6;
      else if (text.includes(wort)) punkte += 2;
      else if (bereichText.includes(wort)) punkte += 1;
      else { alle = false; break; }
    }
    if (alle) treffer.push({ art: "frage", id: frage.id, titel: frage.frage, text: frage.antwort, bereich: frage.bereich, frage, punkte, reihe: 0 });
  }
  for (const thema of themen) {
    if (!darfSehen(thema.sichtbar_fuer, darf)) continue;
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
      if (alle) {
        treffer.push({
          art: "schritt", id: `${thema.slug}-${schritt.id}`, titel: schritt.titel, text: schritt.text,
          bereich: schritt.abschnitt.bereich || thema.bereich, thema, to: hilfePfad(thema.slug, schritt.id), punkte, reihe: schritt.nummer,
        });
      }
    }
  }
  const imText = woerter.length * 2;
  const starke = treffer.some((row) => row.punkte >= imText) ? treffer.filter((row) => row.punkte >= imText) : treffer;
  return starke
    .sort((a, b) => b.punkte - a.punkte || (a.art === b.art ? a.reihe - b.reihe : a.art === "frage" ? -1 : 1))
    .slice(0, limit);
}

function gueltigeFrage(frage: unknown): frage is FaqFrage {
  const row = frage as Partial<FaqFrage> | null;
  return Boolean(row && typeof row === "object" && row.id && row.frage && row.antwort && row.bereich && row.sichtbar_fuer);
}

/** Antwort des Servers in die Form der App bringen: nur bekannte Rechte, nur vollständige Fragen (wie faqZugangAus im Web). */
export function faqZugangAus(data: unknown): { darf: FaqDarf; fragen: FaqFrage[] } {
  const body = (data || {}) as { darf?: Record<string, unknown>; fragen?: unknown };
  const darf = body.darf || {};
  return {
    darf: {
      angemeldet: darf.angemeldet === true,
      mitglied: darf.mitglied === true,
      turnierleitung: darf.turnierleitung === true,
      turnierleitung_verwaltung: darf.turnierleitung_verwaltung === true,
    },
    fragen: Array.isArray(body.fragen) ? body.fragen.filter(gueltigeFrage).map((frage) => ({ ...frage, rollen: Array.isArray(frage.rollen) ? frage.rollen : [] })) : [],
  };
}

/** Öffentliche Fragen und die des Servers zusammen - eine Kennung zählt einmal, die öffentliche gewinnt. */
export function alleFragen(vomServer: FaqFrage[], oeffentlich: FaqFrage[] = FRAGEN): FaqFrage[] {
  const bekannt = new Set(oeffentlich.map((frage) => frage.id));
  return [...oeffentlich, ...vomServer.filter((frage) => !bekannt.has(frage.id))];
}
