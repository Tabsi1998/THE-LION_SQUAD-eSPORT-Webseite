import fs from "fs";
import path from "path";
import { viennaDate, viennaDateTime, viennaTime } from "./vienna";

// #943: Daten immer in de-AT und Wiener Zeit - egal, wo das Handy steht und wie der Prüfrechner tickt.

test("nennt den Monat österreichisch und rechnet in Wiener Zeit", () => {
  const silvester = "2026-12-31T23:30:00Z"; // in Wien schon der 1. Jänner, 00:30
  expect(viennaDate(silvester, { day: "numeric", month: "long", year: "numeric" })).toBe("1. Jänner 2027");
  expect(viennaTime(silvester, { hour: "2-digit", minute: "2-digit" })).toBe("00:30");
  expect(viennaDateTime(new Date("2026-07-04T17:00:00Z"), { hour: "2-digit", minute: "2-digit" })).toBe("19:00");
  expect(viennaDate(null)).toBe("");
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
