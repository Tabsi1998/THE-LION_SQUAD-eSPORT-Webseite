import fs from "fs";
import path from "path";
import { targetFromUrl } from "../navigation/rootNavigation";
import {
  EINSTELLUNGEN, GRUPPEN, einstellungZiel, einstellungenDer, gruppenFuer, offenJeGruppe, offenText, schnellwege, sichtbar, siehtVerein, sucheEinstellungen,
} from "./meinBereich";

// Mein Bereich (#2059, #1677): dieselben Gruppen und Namen wie im Web, die Schnellwege der Abnahme und die Suche, die jede
// bisherige Einstellung der App findet - nichts geht verloren.

const MITGLIED = { mitglied: true };

test("die acht Gruppen in der Reihenfolge und mit den Namen des Webs", () => {
  expect(GRUPPEN.map((item) => [item.key, item.label])).toEqual([
    ["start", "Übersicht"],
    ["profil", "Profil"],
    ["mitgliedschaft", "Mitgliedschaft"],
    ["rechnungen", "Rechnungen & Unterlagen"],
    ["verein", "Verein"],
    ["benachrichtigungen", "Benachrichtigungen"],
    ["konto", "Konto & Sicherheit"],
    ["datenschutz", "Datenschutz"],
  ]);
  // „Verein“ nur für Mitglieder - wie im Web (gruppenFuer).
  expect(gruppenFuer().map((item) => item.key)).not.toContain("verein");
  expect(gruppenFuer(MITGLIED).map((item) => item.key)).toContain("verein");
});

test("die Gruppen des Webs stehen gleich in frontend/src/lib/meinBereich.js", () => {
  // Wächter: ändert das Web einen Namen, schlägt dieser Test an, statt dass App und Web auseinanderlaufen.
  const web = path.resolve(__dirname, "../../../frontend/src/lib/meinBereich.js");
  if (!fs.existsSync(web)) return;
  const source = fs.readFileSync(web, "utf8");
  if (!source.includes("export const GRUPPEN")) return;
  for (const item of GRUPPEN) expect([item.key, source.includes(`key: "${item.key}"`) && source.includes(`label: "${item.label}"`)]).toEqual([item.key, true]);
});

test("Häufig gebraucht: Wunschnummer, Anschrift, Rechnungen, Passwort, Konto löschen - die ersten zwei nur für Mitglieder", () => {
  expect(schnellwege(MITGLIED).map((item) => item.label)).toEqual(["Wunschnummer", "Anschrift ändern", "Rechnungen", "Passwort ändern", "Konto löschen"]);
  expect(schnellwege().map((item) => item.key)).toEqual(["rechnungen", "passwort", "loeschung"]);
  // Jeder Weg hat einen Screen in der App - dieselben Adressen wie im Web.
  for (const item of schnellwege(MITGLIED)) expect([item.key, targetFromUrl(item.to)]).toEqual([item.key, expect.objectContaining({ kind: expect.any(String) })]);
  expect(targetFromUrl(schnellwege(MITGLIED)[0].to)).toEqual({ kind: "detail", screen: "MyMembership", params: { ziel: "nummer" } });
  expect(targetFromUrl(schnellwege(MITGLIED)[1].to)).toEqual({ kind: "detail", screen: "MyMembership", params: { ziel: "meine-daten" } });
  expect(targetFromUrl(schnellwege()[1].to)).toEqual({ kind: "detail", screen: "MeinBereichGruppe", params: { gruppe: "konto", ziel: "passwort" } });
  expect(targetFromUrl(schnellwege()[2].to)).toEqual({ kind: "detail", screen: "MeinBereichGruppe", params: { gruppe: "datenschutz", ziel: "loeschung" } });
});

test("offen je Gruppe zählt wie die Seite - „1 offen“, „3 offen“", () => {
  expect(offenJeGruppe([{ gruppe: "verein", anzahl: 2 }, { gruppe: "verein", anzahl: 1 }, { gruppe: "rechnungen", anzahl: 1 }])).toEqual({ verein: 3, rechnungen: 1 });
  expect(offenText(1)).toBe("1 offen");
  expect(offenText(3)).toBe("3 offen");
});

// Jede Einstellung, die die App vor Mein Bereich hatte (Einstellungen hinter dem Zahnrad, #1146, und der Profil-Tab) - mit
// dem Wort, unter dem man sie damals fand. Jede muss die Suche finden, und zwar in der Gruppe, in der sie jetzt wohnt.
const BISHER: Array<[string, string]> = [
  ["Darstellung", "konto"],
  ["Saison-Deko", "konto"],
  ["Benachrichtigungen", "benachrichtigungen"],
  ["Stufe", "benachrichtigungen"],
  ["Themen", "benachrichtigungen"],
  ["Ruhezeit", "benachrichtigungen"],
  ["Weitere Wege", "benachrichtigungen"],
  ["Kanäle", "benachrichtigungen"],
  ["Discord", "benachrichtigungen"],
  ["Newsletter", "benachrichtigungen"],
  ["Sammel-Mail", "benachrichtigungen"],
  ["App-Sperre mit Fingerabdruck", "konto"],
  ["Passkeys", "konto"],
  ["Angemeldete Geräte", "konto"],
  ["Öffentliches Profil", "datenschutz"],
  ["Erfolge öffentlich", "datenschutz"],
  ["Vereinsinterne Erfolge zeigen", "datenschutz"],
  ["Twitch im Profil anzeigen", "datenschutz"],
  ["Saison-Fundstücke öffentlich", "datenschutz"],
  ["Freunde sehen, wo ich angemeldet bin", "datenschutz"],
  ["Direktnachrichten", "datenschutz"],
  ["Blockierte Benutzer", "datenschutz"],
  ["Profil bearbeiten", "profil"],
  ["Mein Kalender-Abo", "konto"],
  ["Meine Daten", "datenschutz"],
  ["Abmelden", "konto"],
  ["Konto löschen", "datenschutz"],
  ["Version", "konto"],
  ["Was ist neu", "konto"],
  ["FAQ", "konto"],
  ["Fehler melden", "konto"],
  ["Datenschutz", "konto"],
  ["Impressum", "konto"],
  // Aus dem Profil-Tab: „Nur für dich“ und die Reiter.
  ["Rechnungen", "rechnungen"],
  ["Deine Unterlagen", "rechnungen"],
  ["Gewinne", "rechnungen"],
  ["Moderation", "rechnungen"],
  ["Erfolge", "profil"],
  ["Trophäen", "profil"],
  // Aus Verein → Mitgliedschaft.
  ["Wunschnummer", "mitgliedschaft"],
  ["Anschrift", "mitgliedschaft"],
  ["Austritt", "mitgliedschaft"],
  ["Mitgliedskarte", "mitgliedschaft"],
  ["Versammlungen", "verein"],
  ["Helferdienste", "verein"],
  ["Vereinsdokumente", "verein"],
  ["Mitgliedervorteile", "verein"],
];

test("jede bisherige Einstellung findet die Suche - in der Gruppe, in der sie jetzt wohnt", () => {
  for (const [wort, gruppe] of BISHER) {
    const treffer = sucheEinstellungen(wort, MITGLIED);
    expect([wort, treffer.some((item) => item.gruppe === gruppe)]).toEqual([wort, true]);
  }
});

test("Suche: Umlaute auch ausgeschrieben, Groß und klein egal, mehrere Wörter, Tippfehler am Ende ohne Treffer", () => {
  expect(sucheEinstellungen("geraete", MITGLIED).map((item) => item.ziel)).toContain("geraete");
  expect(sucheEinstellungen("KONTO LÖSCHEN", MITGLIED).map((item) => item.ziel)).toContain("loeschung");
  expect(sucheEinstellungen("fingerabdruck sperre", MITGLIED).map((item) => item.ziel)).toEqual(["app-sperre"]);
  expect(sucheEinstellungen("passwort", MITGLIED)[0]).toMatchObject({ gruppe: "konto", ziel: "passwort" });
  expect(sucheEinstellungen("zzzz", MITGLIED)).toEqual([]);
  // Ein Zeichen allein sucht nicht - sonst stünde beim ersten Tipp alles da.
  expect(sucheEinstellungen("a", MITGLIED)).toEqual([]);
  expect(sucheEinstellungen("  ", MITGLIED)).toEqual([]);
});

test("Suche ohne Sprung: die Treffer behalten beim Weitertippen ihre Reihenfolge - die Liste wird nur kürzer", () => {
  const kurz = sucheEinstellungen("pr", MITGLIED).map((item) => `${item.gruppe}:${item.ziel}`);
  const lang = sucheEinstellungen("profil", MITGLIED).map((item) => `${item.gruppe}:${item.ziel}`);
  expect(lang.length).toBeGreaterThan(1);
  expect(lang.every((key) => kurz.includes(key))).toBe(true);
  expect(kurz.filter((key) => lang.includes(key))).toEqual(lang);
  // In der Reihenfolge der Gruppen.
  const order = GRUPPEN.map((item) => item.key);
  const groups = sucheEinstellungen("an", MITGLIED).map((item) => order.indexOf(item.gruppe));
  expect(groups.length).toBeGreaterThan(3);
  expect(groups).toEqual([...groups].sort((a, b) => a - b));
});

test("wer was sieht: Gäste nur Darstellung und Über die App, Nicht-Mitglieder „Mitglied werden“ statt der Vereinsdinge", () => {
  const gast = EINSTELLUNGEN.filter((item) => sichtbar(item, { gast: true })).map((item) => item.ziel);
  expect(gast).toEqual(["darstellung", "version", "was-ist-neu", "faq", "fehler-melden", "datenschutzerklaerung", "impressum"]);
  expect(einstellungenDer("mitgliedschaft").map((item) => item.ziel)).toEqual(["beitreten"]);
  expect(einstellungenDer("mitgliedschaft", MITGLIED).map((item) => item.ziel)).not.toContain("beitreten");
  expect(einstellungenDer("verein")).toEqual([]);
  expect(sucheEinstellungen("wunschnummer")).toEqual([]);
  expect(sucheEinstellungen("mitglied werden").map((item) => item.ziel)).toEqual(["beitreten"]);
});

test("jede Einstellung hat einen Ort in der App - ihre Adresse öffnet einen Screen, keine zwei mit derselben Stelle", () => {
  const keys = new Set<string>();
  for (const item of EINSTELLUNGEN) {
    const key = `${item.gruppe}:${item.ziel}`;
    expect([key, keys.has(key)]).toEqual([key, false]);
    keys.add(key);
    expect([key, targetFromUrl(einstellungZiel(item))]).toEqual([key, expect.objectContaining({ kind: expect.any(String) })]);
    expect(item.label.length).toBeGreaterThan(1);
  }
  // Eine Stelle in der Gruppe führt in genau diese Gruppe.
  expect(targetFromUrl(einstellungZiel(EINSTELLUNGEN.find((item) => item.ziel === "ruhezeit")!))).toEqual({ kind: "detail", screen: "MeinBereichGruppe", params: { gruppe: "benachrichtigungen", ziel: "ruhezeit" } });
});

test("„Verein“ sehen Mitglieder und die Verwaltung - wie im Web (siehtVerein = Mitglied oder ein Bereich der Verwaltung)", () => {
  expect(siehtVerein({ is_club_member: true })).toBe(true);
  expect(siehtVerein({ is_club_member: false, areas: ["club"] })).toBe(true);
  expect(siehtVerein({ areas: ["tournaments"] })).toBe(true);
  // Moderation allein ist kein Bereich der Verwaltung (ADMIN_AREAS im Web).
  expect(siehtVerein({ areas: ["moderation"] })).toBe(false);
  expect(siehtVerein({})).toBe(false);
  expect(siehtVerein(null)).toBe(false);
});
