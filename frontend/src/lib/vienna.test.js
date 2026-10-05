import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { viennaDate, viennaDateTime, viennaTime } from "./vienna";

// #943: Daten immer in de-AT und Wiener Zeit - egal, wo der Browser steht und wie der Prüfrechner tickt.

describe("vienna", () => {
  it("nennt den Monat österreichisch und rechnet in Wiener Zeit", () => {
    const silvester = "2026-12-31T23:30:00Z"; // in Wien schon der 1. Jänner, 00:30
    expect(viennaDate(silvester, { day: "numeric", month: "long", year: "numeric" })).toBe("1. Jänner 2027");
    expect(viennaTime(silvester, { hour: "2-digit", minute: "2-digit" })).toBe("00:30");
    expect(viennaDateTime(silvester, { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })).toBe("01.01., 00:30");
  });

  it("nimmt Datum, Zeitstempel und Text - und sagt ohne Wert nichts", () => {
    const sommer = new Date("2026-07-04T17:00:00Z"); // Sommerzeit: 19 Uhr
    expect(viennaTime(sommer, { hour: "2-digit", minute: "2-digit" })).toBe("19:00");
    expect(viennaTime(sommer.getTime(), { hour: "2-digit", minute: "2-digit" })).toBe("19:00");
    expect(viennaDate(null)).toBeUndefined();
    expect(viennaDateTime(undefined)).toBeUndefined();
  });

  it("lässt eine ausdrücklich gewünschte andere Zone gelten", () => {
    expect(viennaTime("2026-07-04T17:00:00Z", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" })).toBe("17:00");
  });
});

describe("keine Datumsanzeige an der Hilfe vorbei", () => {
  const root = path.resolve(__dirname, "..");
  const sources = [];
  (function collect(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) collect(full);
      else if (/\.(jsx?|tsx?)$/.test(entry.name) && !/\.test\./.test(entry.name) && !full.endsWith(path.join("lib", "vienna.js"))) sources.push(full);
    }
  })(root);

  it("toLocaleDateString und toLocaleTimeString stehen nur in lib/vienna.js", () => {
    const direct = sources.filter((file) => /\.toLocale(Date|Time)String\(/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(root, file));
    expect(direct, "viennaDate/viennaTime aus @/lib/vienna nehmen").toEqual([]);
  });

  it("toLocaleString bleibt den Zahlen vorbehalten", () => {
    const dateOptions = /\.toLocaleString\(\s*["'][A-Za-z-]+["']\s*,\s*\{[^}]*\b(day|month|year|weekday|hour|minute|dateStyle|timeStyle)\b/;
    const dateReceiver = /new Date\([^()]*\)\.toLocaleString\(/;
    const direct = sources.filter((file) => {
      const text = fs.readFileSync(file, "utf8");
      return dateOptions.test(text) || dateReceiver.test(text);
    }).map((file) => path.relative(root, file));
    expect(direct, "viennaDateTime aus @/lib/vienna nehmen").toEqual([]);
  });
});
