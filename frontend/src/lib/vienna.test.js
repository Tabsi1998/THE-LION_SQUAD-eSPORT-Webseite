import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { asInstant, dayBefore, dayNoon, viennaDate, viennaDateTime, viennaDay, viennaTime } from "./vienna";

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

  it("zählt die Tage in Wien - auch wenn es anderswo noch gestern oder schon morgen ist", () => {
    expect(viennaDay("2026-10-03T21:59:59Z")).toBe("2026-10-03"); // 23:59 in Wien
    expect(viennaDay("2026-10-03T22:00:00Z")).toBe("2026-10-04"); // Mitternacht in Wien
    expect(viennaDay(new Date("2026-12-31T23:30:00Z"))).toBe("2027-01-01");
    expect(viennaDay(Date.parse("2026-01-15T22:59:00Z"))).toBe("2026-01-15"); // Winterzeit: 23:59
    expect(viennaDay(null)).toBe("");
    expect(viennaDay("kein Datum")).toBe("");
  });

  it("beschriftet einen Kalendertag und findet den Tag davor - über Monat, Jahr und Zeitumstellung", () => {
    expect(viennaDate(dayNoon("2026-10-03"), { weekday: "long", day: "numeric", month: "long" })).toBe("Samstag, 3. Oktober");
    expect(viennaDay(dayNoon("2026-01-01"))).toBe("2026-01-01");
    expect(dayBefore("2026-10-03")).toBe("2026-10-02");
    expect(dayBefore("2026-03-01")).toBe("2026-02-28");
    expect(dayBefore("2027-01-01")).toBe("2026-12-31");
    expect(dayBefore("2026-10-26")).toBe("2026-10-25"); // der Tag mit 25 Stunden
    expect(dayBefore("2026-03-30")).toBe("2026-03-29"); // der Tag mit 23 Stunden
  });
});

describe("Werte vom Server", () => {
  it("liest eine Zeit ohne Zone als Wiener Uhr - im Sommer wie im Winter", () => {
    expect(asInstant("2026-08-01T00:00:00").toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(asInstant("2026-01-15T19:30").toISOString()).toBe("2026-01-15T18:30:00.000Z");
    expect(asInstant("2026-08-01 14:05:09.123456").toISOString()).toBe("2026-08-01T12:05:09.000Z");
    // Das Datum eines Albums: Mitternacht ohne Zone - bleibt überall der 1. August.
    expect(viennaDate("2026-08-01T00:00:00", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("01.08.2026");
    expect(viennaTime("2026-08-01T19:00:00", { hour: "2-digit", minute: "2-digit" })).toBe("19:00");
    expect(viennaDay("2026-08-01T00:00:00")).toBe("2026-08-01");
  });

  it("rechnet rund um die Zeitumstellung richtig", () => {
    expect(asInstant("2026-03-29T01:59:00").toISOString()).toBe("2026-03-29T00:59:00.000Z"); // noch Winterzeit
    expect(asInstant("2026-03-29T03:00:00").toISOString()).toBe("2026-03-29T01:00:00.000Z"); // schon Sommerzeit
    expect(asInstant("2026-10-25T01:59:00").toISOString()).toBe("2026-10-24T23:59:00.000Z"); // noch Sommerzeit
    expect(asInstant("2026-10-25T03:00:00").toISOString()).toBe("2026-10-25T02:00:00.000Z"); // wieder Winterzeit
  });

  it("lässt Werte mit Zone, reine Daten, Zahlen und fertige Zeitpunkte, wie sie sind", () => {
    expect(asInstant("2026-08-01T00:00:00+02:00").toISOString()).toBe("2026-07-31T22:00:00.000Z");
    expect(asInstant("2026-08-01T00:00:00Z").toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(asInstant("2026-12-31").toISOString()).toBe("2026-12-31T00:00:00.000Z");
    // „Bezahlt bis 31.12.“ bleibt der 31. - auch auf einem Gerät weit östlich oder westlich von Wien.
    expect(viennaDate("2026-12-31", { day: "2-digit", month: "2-digit", year: "numeric" })).toBe("31.12.2026");
    expect(asInstant(1780000000000).getTime()).toBe(1780000000000);
    const moment = new Date("2026-08-01T10:00:00Z");
    expect(asInstant(moment)).toBe(moment);
    expect(Number.isNaN(asInstant("kein Datum").getTime())).toBe(true);
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

  it("Serverwerte gehen roh an die Hilfe - nicht erst durch new Date()", () => {
    const wrapped = sources.filter((file) => /vienna(Date|Time|DateTime|Day)\(new Date\([^)]/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(root, file));
    expect(wrapped, "den Wert selbst übergeben - die Hilfe liest Zeiten ohne Zone als Wiener Uhr").toEqual([]);
  });

  it("Intl.DateTimeFormat steht nie ohne Zeitzone da", () => {
    const zoneless = sources.filter((file) => /Intl\.DateTimeFormat\((?![^;]*timeZone)/.test(fs.readFileSync(file, "utf8"))).map((file) => path.relative(root, file));
    expect(zoneless, "viennaDate/viennaTime nehmen oder timeZone angeben").toEqual([]);
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
