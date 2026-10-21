import fs from "fs";
import path from "path";
import { COUNTRIES, FLAG_RATIOS, countryName, flagBox, flagUrl } from "./countryFlags";

// Flaggen je Termin in der App (#1925, App-Teil in #1945): dieselben Länder, Namen und Seitenverhältnisse wie im Web
// (frontend/src/lib/countries.json, flagRatios.json); die Dateien selbst lädt die App von der Website
// (/assets/flags/<code>.svg) - kein fremder Dienst, keine Kopie im App-Paket.

test("Name, Adresse und Größe einer Flagge - unbekannte Codes ergeben nichts", () => {
  expect(countryName("at")).toBe("Österreich");
  expect(countryName(" GB ")).toBe("Großbritannien");
  expect(countryName("xx")).toBe("");
  expect(countryName(null)).toBe("");
  expect(flagUrl("AT")).toMatch(/\/assets\/flags\/at\.svg$/);
  expect(flagUrl("xx")).toBeNull();
  // Gleiche Höhe, Breite nach dem echten Seitenverhältnis bis höchstens 2:1 (Katar passt sich ein).
  expect(flagBox("ch", 14)).toEqual({ width: 14, height: 14 });
  expect(flagBox("at", 14)).toEqual({ width: 21, height: 14 });
  expect(flagBox("qa", 14)).toEqual({ width: 28, height: 14 });
});

test("dieselben Länder und Seitenverhältnisse wie im Web", () => {
  const web = path.join(__dirname, "..", "..", "..", "frontend", "src", "lib");
  if (!fs.existsSync(path.join(web, "countries.json"))) return;
  expect(COUNTRIES).toEqual(JSON.parse(fs.readFileSync(path.join(web, "countries.json"), "utf8")));
  expect(FLAG_RATIOS).toEqual(JSON.parse(fs.readFileSync(path.join(web, "flagRatios.json"), "utf8")));
});
