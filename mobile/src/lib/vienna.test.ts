import fs from "fs";
import path from "path";
import { asInstant, dayBefore, dayNoon, viennaDate, viennaDateTime, viennaDay, viennaTime } from "./vienna";

// #943: Daten immer in de-AT und Wiener Zeit - egal, wo das Handy steht und wie der Prüfrechner tickt.

test("nennt den Monat österreichisch und rechnet in Wiener Zeit", () => {
  const silvester = "2026-12-31T23:30:00Z"; // in Wien schon der 1. Jänner, 00:30
  expect(viennaDate(silvester, { day: "numeric", month: "long", year: "numeric" })).toBe("1. Jänner 2027");
  expect(viennaTime(silvester, { hour: "2-digit", minute: "2-digit" })).toBe("00:30");
  expect(viennaDateTime(new Date("2026-07-04T17:00:00Z"), { hour: "2-digit", minute: "2-digit" })).toBe("19:00");
  expect(viennaDate(null)).toBe("");
});

test("zählt die Tage in Wien - auch wenn es anderswo noch gestern oder schon morgen ist", () => {
  expect(viennaDay("2026-10-03T21:59:59Z")).toBe("2026-10-03"); // 23:59 in Wien
  expect(viennaDay("2026-10-03T22:00:00Z")).toBe("2026-10-04"); // Mitternacht in Wien
  expect(viennaDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
  expect(viennaDay(Date.parse("2026-01-15T22:59:00Z"))).toBe("2026-01-15"); // Winterzeit: 23:59
  expect(viennaDay(null)).toBe("");
  expect(viennaDay("kein Datum")).toBe("");
});

test("beschriftet einen Kalendertag und findet den Tag davor - über Monat, Jahr und Zeitumstellung", () => {
  expect(viennaDate(dayNoon("2026-10-03"), { weekday: "long", day: "numeric", month: "long" })).toBe("Samstag, 3. Oktober");
  expect(viennaDay(dayNoon("2026-01-01"))).toBe("2026-01-01");
  expect(dayBefore("2026-10-03")).toBe("2026-10-02");
  expect(dayBefore("2026-03-01")).toBe("2026-02-28");
  expect(dayBefore("2027-01-01")).toBe("2026-12-31");
  expect(dayBefore("2026-10-26")).toBe("2026-10-25"); // der Tag mit 25 Stunden
  expect(dayBefore("2026-03-30")).toBe("2026-03-29"); // der Tag mit 23 Stunden
});

test("liest eine Zeit ohne Zone als Wiener Uhr - im Sommer wie im Winter", () => {
  expect(asInstant("2026-08-01T00:00:00").toISOString()).toBe("2026-07-31T22:00:00.000Z");
  expect(asInstant("2026-01-15T19:30").toISOString()).toBe("2026-01-15T18:30:00.000Z");
  expect(asInstant("2026-08-01 14:05:09.123456").toISOString()).toBe("2026-08-01T12:05:09.000Z");
  expect(viennaDate("2026-08-01T00:00:00", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("01.08.2026");
  expect(viennaTime("2026-08-01T19:00:00", { hour: "2-digit", minute: "2-digit" })).toBe("19:00");
  expect(viennaDay("2026-08-01T00:00:00")).toBe("2026-08-01");
});

test("rechnet rund um die Zeitumstellung richtig", () => {
  expect(asInstant("2026-03-29T01:59:00").toISOString()).toBe("2026-03-29T00:59:00.000Z"); // noch Winterzeit
  expect(asInstant("2026-03-29T03:00:00").toISOString()).toBe("2026-03-29T01:00:00.000Z"); // schon Sommerzeit
  expect(asInstant("2026-10-25T01:59:00").toISOString()).toBe("2026-10-24T23:59:00.000Z"); // noch Sommerzeit
  expect(asInstant("2026-10-25T03:00:00").toISOString()).toBe("2026-10-25T02:00:00.000Z"); // wieder Winterzeit
});

test("lässt Werte mit Zone, reine Daten, Zahlen und fertige Zeitpunkte, wie sie sind", () => {
  expect(asInstant("2026-08-01T00:00:00+02:00").toISOString()).toBe("2026-07-31T22:00:00.000Z");
  expect(asInstant("2026-12-31").toISOString()).toBe("2026-12-31T00:00:00.000Z");
  // „Gültig bis 31.12.“ bleibt der 31. - auch auf einem Handy weit östlich oder westlich von Wien.
  expect(viennaDate("2026-12-31", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("31.12.2026");
  expect(asInstant(1780000000000).getTime()).toBe(1780000000000);
  const moment = new Date("2026-08-01T10:00:00Z");
  expect(asInstant(moment)).toBe(moment);
  expect(Number.isNaN(asInstant("kein Datum").getTime())).toBe(true);
});

function sources(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sources(full, out);
    else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name) && !full.endsWith(path.join("lib", "vienna.ts"))) out.push(full);
  }
  return out;
}

const ROOT = path.resolve(__dirname, "..");

test("keine Datumsanzeige an der Hilfe vorbei", () => {
  const direct = sources(ROOT).filter((file) => {
    const text = fs.readFileSync(file, "utf8");
    return /\.toLocale(Date|Time)String\(/.test(text) || /new Date\([^()]*\)\.toLocaleString\(/.test(text)
      || /\.toLocaleString\(\s*["'][A-Za-z-]+["']\s*,\s*\{[^}]*\b(day|month|year|weekday|hour|minute|dateStyle|timeStyle)\b/.test(text);
  }).map((file) => path.relative(ROOT, file));
  expect(direct).toEqual([]);
});

test("Serverwerte gehen roh an die Hilfe, und Intl.DateTimeFormat steht nie ohne Zeitzone da", () => {
  const texts = sources(ROOT).map((file) => [path.relative(ROOT, file), fs.readFileSync(file, "utf8")]);
  // Den Wert selbst übergeben - die Hilfe liest Zeiten ohne Zone als Wiener Uhr.
  expect(texts.filter(([, text]) => /vienna(Date|Time|DateTime|Day)\(new Date\([^)]/.test(text)).map(([file]) => file)).toEqual([]);
  expect(texts.filter(([, text]) => /Intl\.DateTimeFormat\((?![^;]*timeZone)/.test(text)).map(([file]) => file)).toEqual([]);
});

// Umlaute (#943): „fuer“ statt „für“ stand in zwei Sätzen des Profils - die Prüfung des Webs sah die App nicht.
const DISALLOWED = ["Uebersicht", "uebersicht", "Ueber", "ueber", "Loeschen", "loeschen", "Oeffnen", "oeffnen", "Waehlen", "waehlen", "Zurueck", "zurueck",
  "Schliessen", "schliessen", "Groesse", "groesse", "Hinzufuegen", "hinzufuegen", "Aendern", "aendern", "Bestaetigen", "bestaetigen", "Muessen", "muessen",
  "Empfaenger", "empfaenger", "Waere", "waere", "Loesung", "loesung", "FUER", "Fuer", "fuer", "koennen", "Koennen", "moeglich", "Moeglich", "naechste", "Naechste"];

test("sichtbare Texte der App schreiben Umlaute aus", () => {
  const found: string[] = [];
  for (const file of sources(ROOT)) {
    const lines = fs.readFileSync(file, "utf8").split("\n");
    lines.forEach((line, index) => {
      // Nur Text in Anführungszeichen oder zwischen Tags - Bezeichner im Code dürfen heißen, wie sie wollen.
      const visible = [...line.matchAll(/"([^"\n]*)"|'([^'\n]*)'|`([^`\n]*)`|>([^<>{}\n]+)</g)].map((match) => match[1] ?? match[2] ?? match[3] ?? match[4] ?? "").join(" ");
      for (const word of DISALLOWED) {
        if (new RegExp(`(^|[^A-Za-zÄÖÜäöüß])${word}`).test(visible)) found.push(`${path.relative(ROOT, file)}:${index + 1} ${word}`);
      }
    });
  }
  expect(found).toEqual([]);
});
