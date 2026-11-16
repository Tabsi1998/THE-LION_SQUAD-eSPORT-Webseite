import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import masse from "./bilder/masse.json";
import anker from "./anker.json";
import {
  BEREICHE, FORMEN, FRAGEN, ROLLEN, SICHTBARKEITEN, THEMEN, ankerAus, bereichInhalt, darfSehen, faqBereichsliste, fragePfad,
  haeufigeFragen, hilfeBild, hilfeNormal, hilfePfad, hilfeSchritte, hilfeThema, hilfeVideo, passtZuRolle, sichtbareBereiche,
  sichtbareRollen, sucheFaq, sucheHilfe,
} from "./index";

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
      expect(schritt.link.to.startsWith("/hilfe"), schritt.link.to).toBe(false);
      const match = schritt.link.to.match(/^\/faq\/([^#]+)#(.+)$/);
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
  expect(hilfePfad("turniere")).toBe("/faq/turniere");
  expect(hilfePfad("turniere", "anmelden")).toBe("/faq/turniere#anmelden");
  expect(fragePfad("team-beitreten")).toBe("/faq#frage-team-beitreten");
});

// FAQ (#2448): Inhaltsmodell, Sichtbarkeit, Bereiche, Filter und Suche über Fragen und Schritte.

const BEREICH_IDS = new Set(BEREICHE.map((bereich) => bereich.id));
const ROLLEN_IDS = new Set(ROLLEN.map((rolle) => rolle.id));
const GESCHUETZT = /"sichtbar_fuer":\s*"(angemeldet|mitglied|turnierleitung)"/;

test("Kein geschützter Inhalt im öffentlichen Datensatz: Fragen und Anleitungen nur „alle“", () => {
  for (const frage of FRAGEN) expect(frage.sichtbar_fuer, frage.id).toBe("alle");
  for (const thema of THEMEN) expect(thema.sichtbar_fuer, thema.slug).toBe("alle");
  for (const name of ["fragen.json", ...readdirSync(resolve(ROOT, "themen")).map((file) => `themen/${file}`)]) {
    expect(readFileSync(resolve(ROOT, name), "utf8"), name).not.toMatch(GESCHUETZT);
  }
});

test("Inhaltsmodell: jede Frage und jedes Thema mit Bereich, Rollen und Sichtbarkeit; Kennungen eindeutig", () => {
  expect(new Set(BEREICHE.map((bereich) => bereich.id)).size).toBe(BEREICHE.length);
  for (const bereich of BEREICHE) {
    expect(bereich.titel && bereich.kurz && bereich.icon, bereich.id).toBeTruthy();
    expect(SICHTBARKEITEN).toContain(bereich.sichtbar_fuer);
    for (const rolle of bereich.rollen) expect(ROLLEN_IDS.has(rolle), `${bereich.id}: ${rolle}`).toBe(true);
  }
  const ids = FRAGEN.map((frage) => frage.id);
  expect(new Set(ids).size).toBe(ids.length);
  for (const eintrag of [...FRAGEN, ...THEMEN]) {
    const name = eintrag.id || eintrag.slug;
    expect(BEREICH_IDS.has(eintrag.bereich), `${name}: ${eintrag.bereich}`).toBe(true);
    expect(eintrag.rollen.length, name).toBeGreaterThan(0);
    for (const rolle of eintrag.rollen) expect(ROLLEN_IDS.has(rolle), `${name}: ${rolle}`).toBe(true);
  }
  for (const thema of THEMEN) {
    for (const abschnitt of thema.abschnitte) if (abschnitt.bereich) expect(BEREICH_IDS.has(abschnitt.bereich), abschnitt.id).toBe(true);
  }
  for (const frage of FRAGEN) {
    expect(frage.id).toMatch(/^[a-z0-9-]+$/);
    expect(frage.frage.endsWith("?"), frage.id).toBe(true);
    if (!frage.link) continue;
    expect(frage.link.to.startsWith("/") && !frage.link.to.startsWith("/hilfe"), frage.link.to).toBe(true);
    const match = frage.link.to.match(/^\/faq\/([^#]+)#(.+)$/);
    if (match) expect(hilfeSchritte(hilfeThema(match[1])).some((row) => row.id === match[2]), frage.link.to).toBe(true);
  }
});

test("Antworten kurz: kein Satz über 22 Wörter, höchstens drei Sätze, keine Gedankenstrich-Ketten", () => {
  for (const frage of FRAGEN) {
    const saetze = frage.antwort.split(/(?<=[.?!])\s+/);
    expect(saetze.length, frage.id).toBeLessThanOrEqual(3);
    for (const satz of saetze) expect(satz.split(/\s+/).length, `${frage.id}: ${satz}`).toBeLessThanOrEqual(22);
  }
  expect(readFileSync(resolve(ROOT, "fragen.json"), "utf8")).not.toMatch(/ – .* – /);
});

test("Häufige Fragen: 8 bis 12 öffentliche, quer über die Bereiche", () => {
  const haeufig = haeufigeFragen();
  expect(haeufig.length).toBeGreaterThanOrEqual(8);
  expect(haeufig.length).toBeLessThanOrEqual(12);
  expect(new Set(haeufig.map((frage) => frage.bereich)).size).toBeGreaterThanOrEqual(5);
});

test("Sichtbarkeit: alle immer, sonst nur mit Recht; Unbekanntes bleibt zu", () => {
  expect(darfSehen("alle")).toBe(true);
  expect(darfSehen("mitglied", {})).toBe(false);
  expect(darfSehen("mitglied", { mitglied: true })).toBe(true);
  expect(darfSehen("turnierleitung", { mitglied: true })).toBe(false);
  expect(darfSehen("vorstand", { vorstand: true })).toBe(false);
  expect(sichtbareRollen({}).map((rolle) => rolle.id)).toEqual(["spieler", "captain", "mitglied"]);
  expect(sichtbareRollen({ turnierleitung: true }).map((rolle) => rolle.id)).toContain("turnierleitung");
  const gast = sichtbareBereiche().map((bereich) => bereich.id);
  expect(gast).not.toContain("helferdienste");
  expect(gast).not.toContain("turnierleitung");
  expect(sichtbareBereiche({ darf: { mitglied: true } }).map((bereich) => bereich.id)).toContain("helferdienste");
  expect(sichtbareBereiche({ darf: { turnierleitung: true } }).map((bereich) => bereich.id)).toContain("turnierleitung");
});

test("Bereiche: bestehende Anleitungen eingeordnet, Abschnitte auch im zweiten Bereich, leere als leer", () => {
  const slugs = (id, optionen) => bereichInhalt(id, optionen).anleitungen.map(({ thema, abschnitt }) => `${thema.slug}${abschnitt ? `#${abschnitt.id}` : ""}`);
  expect(slugs("konto-profil")).toEqual(["konto-und-profil"]);
  expect(slugs("benachrichtigungen")).toEqual(["konto-und-profil#benachrichtigungen"]);
  expect(slugs("teams")).toEqual(["team-und-co-team"]);
  expect(slugs("liga")).toEqual(["liga-captains"]);
  expect(slugs("turniere")).toEqual(["turniere"]);
  expect(slugs("turniertag")).toEqual(["turniere#check-in-turnier"]);
  // Jede Anleitung steht in genau einem Hauptbereich.
  for (const thema of THEMEN) expect(BEREICHE.filter((bereich) => slugs(bereich.id).includes(thema.slug)).length, thema.slug).toBe(1);
  // Liga ist nichts für den Filter Mitglied; Helferdienste ohne Fragen vom Server sind leer.
  expect(slugs("liga", { rolle: "mitglied" })).toEqual([]);
  expect(bereichInhalt("helferdienste", { darf: { mitglied: true } }).leer).toBe(true);
  const geschuetzt = { id: "x", frage: "X?", antwort: "Y.", bereich: "helferdienste", rollen: ["mitglied"], sichtbar_fuer: "mitglied" };
  expect(bereichInhalt("helferdienste", { fragen: [geschuetzt], darf: {} }).leer).toBe(true);
  expect(bereichInhalt("helferdienste", { fragen: [geschuetzt], darf: { mitglied: true } }).fragen).toEqual([geschuetzt]);
  expect(passtZuRolle({ rollen: ["captain"] }, "spieler")).toBe(false);
  expect(passtZuRolle({ rollen: ["captain"] }, "")).toBe(true);
});

test("Suche über Fragen und Schritte: Bereich am Treffer, Geschütztes nur mit Recht", () => {
  expect(sucheFaq("")).toEqual([]);
  const checkin = sucheFaq("check-in", { limit: 50 });
  expect(checkin.find((row) => row.id === "turniere-einchecken")).toMatchObject({ art: "schritt", bereich: "turniertag", to: "/faq/turniere#einchecken" });
  expect(checkin.find((row) => row.id === "liga-captains-check-in")).toMatchObject({ bereich: "liga" });
  expect(checkin.find((row) => row.id === "check-in-vor-ort")).toMatchObject({ art: "frage", bereich: "turniertag", to: "/faq#frage-check-in-vor-ort" });
  expect(sucheFaq("Activision")[0]).toMatchObject({ art: "frage", id: "activision-id" });
  // Treffer nur über die Suchbegriffe des Themas fallen weg, sobald es echte Treffer im Text gibt.
  const einchecken = sucheFaq("einchecken", { limit: 50 }).map((row) => row.id);
  expect(einchecken).toContain("liga-captains-check-in");
  expect(einchecken).not.toContain("liga-captains-co-team-auswahl");
  const geschuetzt = { id: "geheim", frage: "Wo ist der Schichtplan?", antwort: "Im Mitgliederbereich.", bereich: "helferdienste", rollen: ["mitglied"], sichtbar_fuer: "mitglied" };
  expect(sucheFaq("Schichtplan", { fragen: [...FRAGEN, geschuetzt] })).toEqual([]);
  expect(sucheFaq("Schichtplan", { fragen: [...FRAGEN, geschuetzt], darf: { mitglied: true } }).map((row) => row.id)).toEqual(["geheim"]);
  expect(sucheFaq("gibtsnichtwirklich")).toEqual([]);
});

// Review-Runde 1 (#2448).

test("F2: Leitungs-Fragen mit Weg über die Verwaltung brauchen die eigene Stufe", () => {
  expect(SICHTBARKEITEN).toContain("turnierleitung_verwaltung");
  expect(darfSehen("turnierleitung_verwaltung", { turnierleitung: true })).toBe(false);
  expect(darfSehen("turnierleitung_verwaltung", { turnierleitung: true, turnierleitung_verwaltung: true })).toBe(true);
});

test("F4: Rollen von Bereich und Inhalt passen zusammen, jede Rolle gegen jeden Bereich", () => {
  const alleRechte = { angemeldet: true, mitglied: true, turnierleitung: true, turnierleitung_verwaltung: true };
  for (const bereich of BEREICHE) {
    const inhalt = bereichInhalt(bereich.id, { darf: alleRechte });
    if (inhalt.leer) continue; // Inhalt folgt (Paket 3) oder kommt nur vom Server
    const inhaltsRollen = new Set([...inhalt.fragen, ...inhalt.anleitungen.map(({ thema }) => thema)].flatMap((eintrag) => eintrag.rollen));
    expect([...inhaltsRollen].sort(), bereich.id).toEqual([...bereich.rollen].sort());
  }
  for (const { id: rolle } of ROLLEN) {
    const liste = faqBereichsliste({ rolle, darf: alleRechte });
    for (const { bereich, inhalt } of liste) {
      expect(inhalt.leer, `${rolle} · ${bereich.id}`).toBe(false);
      expect(bereich.rollen, `${rolle} · ${bereich.id}`).toContain(rolle);
    }
    for (const bereich of BEREICHE.filter((row) => row.rollen.includes(rolle))) {
      const leer = bereichInhalt(bereich.id, { rolle, darf: alleRechte }).leer;
      expect(liste.some((row) => row.bereich.id === bereich.id), `${rolle} · ${bereich.id}`).toBe(!leer);
    }
  }
  // Ohne Filter bleibt „Kommt bald“: leere Bereiche stehen in der Liste.
  expect(faqBereichsliste({ darf: { mitglied: true } }).find((row) => row.bereich.id === "helferdienste")?.inhalt.leer).toBe(true);
});

test("F6: ein kaputter Anker zählt als keiner", () => {
  expect(ankerAus("#%E0%A4")).toBe("");
  expect(ankerAus("#check-in")).toBe("check-in");
  expect(ankerAus("#frage-%C3%BC")).toBe("frage-ü");
  expect(ankerAus("")).toBe("");
});

test("F7: Suche zuerst NFC - ein zerlegtes „ä“ findet dasselbe wie das fertige", () => {
  const zerlegt = "Gründe".normalize("NFD");
  expect(zerlegt).not.toBe("Gründe");
  expect(hilfeNormal(zerlegt)).toBe("gruende");
  expect(hilfeNormal("Bestätigen".normalize("NFD"))).toBe("bestaetigen");
  expect(sucheFaq(`Team ${zerlegt}`).map((row) => row.id)).toEqual(sucheFaq("Team gründe").map((row) => row.id));
  expect(sucheFaq("gruende Team").map((row) => row.id)).toContain("team-gruenden");
});
