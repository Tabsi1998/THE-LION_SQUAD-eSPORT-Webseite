import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import masse from "./bilder/masse.json";
import anker from "./anker.json";
import { FORMEN, THEMEN, hilfeBild, hilfeNormal, hilfePfad, hilfeSchritte, hilfeThema, hilfeVideo, sucheHilfe } from "./index";

// Hilfe-Daten (#2295): eindeutige Anker, jedes Bild für Handy und PC vorhanden, Verweise zeigen auf echte Schritte,
// kurze Sätze für Leser ohne Vorwissen, und die Suche findet auch ohne Umlaute.

const ROOT = resolve(__dirname);

test("anker.json (Index für die „?“-Links) passt zu den Themen", () => {
  const expected = Object.fromEntries(THEMEN.map((thema) => [thema.slug, Object.fromEntries(hilfeSchritte(thema).map((schritt) => [schritt.id, schritt.titel]))]));
  // Neu erzeugen: siehe docs/entwicklung/hilfe-bilder.md, Abschnitt „Neues Thema oder neuer Schritt“.
  expect(anker).toEqual(expected);
});

test("jedes Thema liegt als Datei in themen/ und steht in der Liste", () => {
  const files = readdirSync(resolve(ROOT, "themen")).filter((name) => name.endsWith(".json")).map((name) => name.replace(/\.json$/, ""));
  expect(THEMEN.map((thema) => thema.slug).sort()).toEqual(files.sort());
  for (const thema of THEMEN) {
    expect(thema.titel && thema.kurz && thema.zielgruppe, thema.slug).toBeTruthy();
    expect(thema.slug).toMatch(/^[a-z0-9-]+$/);
  }
});

test("Anker je Thema eindeutig - Abschnitte und Schritte zusammen", () => {
  for (const thema of THEMEN) {
    const ids = [...thema.abschnitte.map((abschnitt) => abschnitt.id), ...hilfeSchritte(thema).map((schritt) => schritt.id)];
    // Ein Schritt darf nicht so heißen wie ein Abschnitt - sonst gibt es die id zweimal auf der Seite.
    expect(new Set(ids).size, thema.slug).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z0-9-]+$/);
  }
});

test("jeder Schritt mit Bild hat Handy und PC samt Größe; keine verwaisten Bilder", () => {
  const expected = new Set();
  for (const thema of THEMEN) {
    for (const schritt of hilfeSchritte(thema)) {
      if (!schritt.bild) continue;
      for (const form of FORMEN) {
        const key = `${thema.slug}/${schritt.id}-${form}`;
        expected.add(key);
        const bild = hilfeBild(thema.slug, schritt.id, form);
        expect(bild, `Bild fehlt: ${key} (HILFE_BILDER=1, docs/entwicklung/hilfe-bilder.md)`).not.toBeNull();
        expect(bild.width).toBeGreaterThan(0);
        expect(bild.height).toBeGreaterThan(0);
      }
    }
  }
  expect(Object.keys(masse).sort()).toEqual([...expected].sort());
  for (const thema of THEMEN) {
    const dir = resolve(ROOT, "bilder", thema.slug);
    for (const file of readdirSync(dir)) expect(expected.has(`${thema.slug}/${file.replace(/\.webp$/, "")}`), file).toBe(true);
  }
});

test("Videos: jedes genannte Video gibt es, und es hängt an einem echten Abschnitt", () => {
  for (const thema of THEMEN) {
    for (const video of thema.videos || []) {
      expect(hilfeVideo(video.id), video.id).toBeTruthy();
      expect(thema.abschnitte.some((abschnitt) => abschnitt.id === video.abschnitt), video.abschnitt).toBe(true);
    }
  }
});

test("Verweise zeigen auf Seiten der Website und auf echte Hilfe-Schritte", () => {
  for (const thema of THEMEN) {
    for (const schritt of hilfeSchritte(thema)) {
      if (!schritt.link) continue;
      expect(schritt.link.to.startsWith("/"), schritt.id).toBe(true);
      const match = schritt.link.to.match(/^\/hilfe\/([^#]+)#(.+)$/);
      if (match) expect(hilfeSchritte(hilfeThema(match[1])).some((row) => row.id === match[2]), schritt.link.to).toBe(true);
    }
  }
});

test("Lesbarkeit: kurze Sätze, kein Satz über 22 Wörter, im Schnitt höchstens 13", () => {
  const sentences = [];
  for (const thema of THEMEN) {
    for (const schritt of hilfeSchritte(thema)) {
      for (const text of [schritt.text, schritt.hinweis].filter(Boolean)) {
        sentences.push(...text.split(/(?<=[.?!])\s+/).map((satz) => ({ satz, id: `${thema.slug}#${schritt.id}` })));
      }
    }
  }
  const words = (satz) => satz.split(/\s+/).filter(Boolean).length;
  for (const { satz, id } of sentences) expect(words(satz), `${id}: ${satz}`).toBeLessThanOrEqual(22);
  const average = sentences.reduce((sum, { satz }) => sum + words(satz), 0) / sentences.length;
  expect(average).toBeLessThanOrEqual(13);
});

test("Texte ohne Gedankenstrich-Ketten und mit deutschen Anführungszeichen", () => {
  for (const name of readdirSync(resolve(ROOT, "themen"))) {
    const text = readFileSync(resolve(ROOT, "themen", name), "utf8");
    expect(text, name).not.toMatch(/ – .* – /);
    expect(text, name).not.toMatch(/\\"/);
  }
});

test("Suche: jedes Wort muss passen, Umlaute egal, Titel zählen mehr", () => {
  expect(sucheHilfe("")).toEqual([]);
  expect(sucheHilfe("a")).toEqual([]);
  const checkin = sucheHilfe("check-in").map(({ thema, schritt }) => `${thema.slug}#${schritt.id}`);
  expect(checkin).toContain("liga-captains#check-in");
  expect(checkin).toContain("turniere#einchecken");
  expect(sucheHilfe("bestaetigen").map(({ schritt }) => schritt.id)).toEqual(expect.arrayContaining(["bestaetigen", "ergebnis-bestaetigen"]));
  expect(sucheHilfe("Activision")[0].schritt.id).toBe("spiel-ids");
  expect(sucheHilfe("protest")[0].schritt.id).toBe("problem-melden");
  expect(sucheHilfe("gibtsnichtwirklich")).toEqual([]);
  expect(hilfeNormal("Bestätigen – Größe")).toBe("bestaetigen groesse");
});

test("Bild-Adresse mit Größe; Pfade mit Anker", () => {
  const bilder = { "./bilder/turniere/anmelden-handy.webp": "/assets/anmelden-handy-abc.webp" };
  expect(hilfeBild("turniere", "anmelden", "handy", bilder, { "turniere/anmelden-handy": [390, 120] })).toEqual({ src: "/assets/anmelden-handy-abc.webp", width: 390, height: 120 });
  expect(hilfeBild("turniere", "anmelden", "pc", bilder, {})).toBeNull();
  expect(hilfePfad("turniere")).toBe("/hilfe/turniere");
  expect(hilfePfad("turniere", "anmelden")).toBe("/hilfe/turniere#anmelden");
});
