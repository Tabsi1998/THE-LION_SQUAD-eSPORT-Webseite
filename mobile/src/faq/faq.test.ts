import fs from "fs";
import {
  BEREICHE, FRAGEN, OHNE_ZUGANG, THEMEN, alleFragen, bereichInhalt, darfSehen, faqBereichsliste, faqZugangAus, haeufigeFragen,
  hilfeNormal, sichtbareRollen, sucheFaq, type FaqFrage,
} from ".";
import { APP_BEREICH, APP_FRAGEN } from "./appFragen";
import { targetFromUrl } from "../navigation/rootNavigation";

// FAQ in der App (#2449): dieselben Regeln wie die FAQ im Web (#2448). Die öffentlichen Fragen und Anleitungen sind eine
// gebündelte Kopie aus frontend/src/hilfe - der Gleichheitstest baut sie frisch aus den Web-Dateien und vergleicht.
// Abhilfe, wenn er scheitert: `node scripts/sync-faq.js`. Erfundene Daten für die geschützten Fragen.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { build, OUT } = require("../../scripts/sync-faq");

const MITGLIED_FRAGE: FaqFrage = {
  id: "helferdienst-eintragen", frage: "Wie trage ich mich für einen Helferdienst ein?", antwort: "Öffne Helferdienste und tippe auf Ich helfe.",
  bereich: "helferdienste", rollen: ["mitglied"], sichtbar_fuer: "mitglied", haeufig: true,
};
const LEITUNG_FRAGE: FaqFrage = {
  id: "aufruf-leitung", frage: "Wie rufe ich ein Spiel auf?", antwort: "In der Leitungsansicht tippst du bei der Station auf Aufrufen.",
  bereich: "turnierleitung", rollen: ["turnierleitung"], sichtbar_fuer: "turnierleitung",
};
const MITGLIED = { ...OHNE_ZUGANG, angemeldet: true, mitglied: true };

describe("Kopie aus dem Web", () => {
  test("die gebündelte Datei passt zu frontend/src/hilfe (Bereiche, Fragen, Anleitungen)", () => {
    const current = fs.readFileSync(OUT, "utf8").replace(/\r\n/g, "\n");
    expect(current).toBe(build());
  });

  test("öffentlich ist nur, was jeder sehen darf - Geschütztes kommt nur vom Server", () => {
    for (const frage of FRAGEN) expect([frage.id, frage.sichtbar_fuer]).toEqual([frage.id, "alle"]);
    for (const thema of THEMEN) expect([thema.slug, thema.sichtbar_fuer]).toEqual([thema.slug, "alle"]);
  });

  test("von den Anleitungen kommt nur Text mit - Bilder und Schleifen bleiben im Web", () => {
    const text = fs.readFileSync(OUT, "utf8");
    expect(text).not.toMatch(/"bild"|"clip"|\.webp|\.webm|\.mp4/);
    expect(THEMEN.length).toBeGreaterThan(0);
    for (const thema of THEMEN) expect(thema.abschnitte.every((abschnitt) => abschnitt.schritte.length > 0)).toBe(true);
  });
});

describe("Bereich LionsAPP", () => {
  test("steht vorne, jede Frage hat eine eigene Kennung und gehört zum Bereich", () => {
    expect(BEREICHE[0]).toBe(APP_BEREICH);
    expect(new Set(FRAGEN.map((frage) => frage.id)).size).toBe(FRAGEN.length);
    expect(new Set(BEREICHE.map((bereich) => bereich.id)).size).toBe(BEREICHE.length);
    for (const frage of APP_FRAGEN) expect([frage.id, frage.bereich]).toEqual([frage.id, "lionsapp"]);
    // Die Themen aus dem Auftrag: Push und Benachrichtigungen, Aufruf-Ton, Anmelden und Biometrie, ohne Netz, Updates.
    expect(APP_FRAGEN.map((frage) => frage.id)).toEqual(expect.arrayContaining(["app-push-stufen", "app-ruhezeit", "app-kanaele", "app-aufruf-ton", "app-passkey", "app-sperre", "app-offline", "app-aktualisieren"]));
  });

  test("Links der App-Fragen öffnen einen Screen der App", () => {
    for (const frage of APP_FRAGEN.filter((row) => row.link)) {
      expect([frage.id, targetFromUrl(frage.link?.to)]).toEqual([frage.id, expect.objectContaining({ screen: "Settings" })]);
    }
  });
});

describe("Suche", () => {
  test("findet App-Fragen über Frage und Antwort, Umlaute auch ausgeschrieben", () => {
    expect(sucheFaq("Gong")[0]).toMatchObject({ art: "frage", id: "app-aufruf-ton" });
    expect(sucheFaq("Gerätesperre").map((row) => row.id)).toContain("app-sperre");
    expect(sucheFaq("geraetesperre").map((row) => row.id)).toEqual(sucheFaq("Gerätesperre").map((row) => row.id));
    expect(hilfeNormal("Rühezeit")).toBe("ruehezeit");
  });

  test("Schritte der Anleitungen verlinken die Website mit Anker", () => {
    const treffer = sucheFaq("einchecken");
    expect(treffer.find((row) => row.id === "turniere-einchecken")).toMatchObject({ art: "schritt", to: "/faq/turniere#einchecken", bereich: "turniertag" });
    // Ein Abschnitt in einem zweiten Bereich nimmt dessen Bereich, sonst gilt der des Themas.
    expect(treffer.find((row) => row.id === "turniere-anmelden")).toBeUndefined();
    expect(sucheFaq("Zum Turnier anmelden").find((row) => row.id === "turniere-anmelden")).toMatchObject({ bereich: "turniere" });
  });

  test("jedes Wort muss vorkommen; ein Buchstabe allein sucht nicht", () => {
    expect(sucheFaq("a")).toEqual([]);
    expect(sucheFaq("  ")).toEqual([]);
    expect(sucheFaq("Gong Zebrastreifen")).toEqual([]);
  });
});

describe("Rollen-Filter", () => {
  test("Turnierleitung gibt es als Chip nur mit Leitungsrecht", () => {
    expect(sichtbareRollen(OHNE_ZUGANG).map((row) => row.id)).toEqual(["spieler", "captain", "mitglied"]);
    expect(sichtbareRollen({ ...OHNE_ZUGANG, turnierleitung: true }).map((row) => row.id)).toContain("turnierleitung");
  });

  test("mit Rolle fallen Bereiche und Fragen weg, die nicht passen - leere Bereiche ganz", () => {
    const ohne = faqBereichsliste().map(({ bereich }) => bereich.id);
    const captain = faqBereichsliste({ rolle: "captain" });
    expect(captain.map(({ bereich }) => bereich.id)).toContain("liga");
    expect(captain.every(({ inhalt }) => !inhalt.leer)).toBe(true);
    const mitglied = faqBereichsliste({ rolle: "mitglied" }).map(({ bereich }) => bereich.id);
    expect(mitglied).not.toContain("liga");
    expect(mitglied.length).toBeLessThan(ohne.length);
    // Der Aufruf-Ton ist nichts für reine Mitglieder.
    expect(bereichInhalt("lionsapp", { rolle: "mitglied" }).fragen.map((row) => row.id)).not.toContain("app-aufruf-ton");
    expect(bereichInhalt("lionsapp", { rolle: "spieler" }).fragen.map((row) => row.id)).toContain("app-aufruf-ton");
  });
});

describe("Sichtbarkeit", () => {
  test("ohne Recht nichts Geschütztes - auch wenn eine Frage mitkommt", () => {
    const fragen = alleFragen([MITGLIED_FRAGE, LEITUNG_FRAGE]);
    expect(haeufigeFragen({ fragen, darf: OHNE_ZUGANG }).map((row) => row.id)).not.toContain(MITGLIED_FRAGE.id);
    const bereiche = faqBereichsliste({ fragen, darf: OHNE_ZUGANG }).map(({ bereich }) => bereich.id);
    expect(bereiche).not.toContain("helferdienste");
    expect(bereiche).not.toContain("turnierleitung");
    expect(sucheFaq("Helferdienst", { fragen, darf: OHNE_ZUGANG }).map((row) => row.id)).not.toContain(MITGLIED_FRAGE.id);
  });

  test("mit Recht vom Server: Bereich, Häufige Fragen und Suche zeigen sie", () => {
    const fragen = alleFragen([MITGLIED_FRAGE]);
    expect(haeufigeFragen({ fragen, darf: MITGLIED }).map((row) => row.id)).toContain(MITGLIED_FRAGE.id);
    expect(bereichInhalt("helferdienste", { fragen, darf: MITGLIED }).fragen).toEqual([MITGLIED_FRAGE]);
    expect(sucheFaq("Helferdienst", { fragen, darf: MITGLIED })[0]).toMatchObject({ id: MITGLIED_FRAGE.id });
    // Mitglied heißt nicht Turnierleitung.
    expect(faqBereichsliste({ fragen, darf: MITGLIED }).map(({ bereich }) => bereich.id)).not.toContain("turnierleitung");
  });

  test("Helfer: aktiver Einsatz oder Mitglied - wie am Server", () => {
    const helferFrage: FaqFrage = { ...MITGLIED_FRAGE, id: "mein-dienst", sichtbar_fuer: "helfer" };
    const fragen = alleFragen([helferFrage]);
    expect(faqBereichsliste({ fragen, darf: OHNE_ZUGANG }).map(({ bereich }) => bereich.id)).not.toContain("helferdienste");
    expect(bereichInhalt("helferdienste", { fragen, darf: { ...OHNE_ZUGANG, helfer: true } }).fragen).toEqual([helferFrage]);
    expect(bereichInhalt("helferdienste", { fragen, darf: MITGLIED }).fragen).toEqual([helferFrage]);
    expect(darfSehen("helfer", { ...OHNE_ZUGANG, turnierleitung: true })).toBe(false);
  });

  test("unbekannte Stufen bleiben zu; Rechte nur, wenn der Server genau true sagt", () => {
    expect(darfSehen("alle")).toBe(true);
    expect(darfSehen("vorstand", { vorstand: true } as never)).toBe(false);
    const zugang = faqZugangAus({ darf: { mitglied: "ja", helfer: 1, turnierleitung: true, admin: true }, fragen: [MITGLIED_FRAGE, { id: "kaputt", frage: "Ohne Antwort" }, null] });
    expect(zugang.darf).toEqual({ angemeldet: false, mitglied: false, helfer: false, turnierleitung: true, turnierleitung_verwaltung: false });
    expect(zugang.fragen.map((row) => row.id)).toEqual([MITGLIED_FRAGE.id]);
    expect(faqZugangAus(undefined)).toEqual({ darf: OHNE_ZUGANG, fragen: [] });
  });

  test("eine Kennung zählt einmal - die öffentliche Frage gewinnt", () => {
    const doppelt = { ...FRAGEN[0], antwort: "Andere Antwort vom Server" };
    const fragen = alleFragen([doppelt]);
    expect(fragen.filter((row) => row.id === doppelt.id)).toEqual([FRAGEN[0]]);
  });
});
