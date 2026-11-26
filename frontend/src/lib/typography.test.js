import { SHORT_CAPS_MAX, isShortCaps, shortCaps } from "./typography";

// Großbuchstaben nur für Kurzes (#1303): Seitentitel bis 18 Zeichen stehen GROSS, alles Längere so, wie es eingetippt
// wurde. Gezählt wird, was man sieht - weiche Trennstellen (&shy;) und Ränder nicht.

test("bis 18 Zeichen GROSS, ab 19 Zeichen unverändert", () => {
  expect(SHORT_CAPS_MAX).toBe(18);
  expect(shortCaps("Turniere")).toBe("TURNIERE");
  expect(shortCaps("a".repeat(18))).toBe("A".repeat(18));
  expect(shortCaps("a".repeat(19))).toBe("a".repeat(19));
  expect(shortCaps("Online Cup FC 26: Anmeldung offen für alle Mitglieder")).toBe("Online Cup FC 26: Anmeldung offen für alle Mitglieder");
});

test("Umlaute und ß: deutsch großgeschrieben, gezählt wie geschrieben", () => {
  expect(shortCaps("Übersicht")).toBe("ÜBERSICHT");
  expect(shortCaps("Jahreswertung öäü")).toBe("JAHRESWERTUNG ÖÄÜ");
  // „ß“ wird wie im Browser (text-transform) zu „SS“ - gezählt wird das eingetippte Wort.
  expect(shortCaps("Straße")).toBe("STRASSE");
  expect(shortCaps("Größenübersicht ßß")).toBe("GRÖSSENÜBERSICHT SSSS");
});

test("Zahlen und Zeichen bleiben, wie sie sind", () => {
  expect(shortCaps("FC 26 Cup")).toBe("FC 26 CUP");
  expect(shortCaps("Saison 2026/27")).toBe("SAISON 2026/27");
  expect(shortCaps("12345678901234567890")).toBe("12345678901234567890");
});

test("weiche Trennstellen und Ränder zählen nicht mit", () => {
  const shy = "­";
  expect(shortCaps(`Turnier${shy}verwaltung`)).toBe(`TURNIER${shy}VERWALTUNG`);
  expect(isShortCaps(`  ${"a".repeat(18)}  `)).toBe(true);
  expect(isShortCaps(`${"a".repeat(9)}${shy.repeat(5)}${"a".repeat(9)}`)).toBe(true);
});

test("ein Zeichen aus mehreren Teilen (Emoji) zählt einmal", () => {
  expect(isShortCaps(`${"a".repeat(17)}👨‍👩‍👧`)).toBe(true);
});

test("leer und ohne Wert: leerer Text, kein Fehler", () => {
  expect(shortCaps("")).toBe("");
  expect(shortCaps(null)).toBe("");
  expect(shortCaps(undefined)).toBe("");
  expect(shortCaps(42)).toBe("42");
  expect(isShortCaps("")).toBe(false);
  expect(isShortCaps(null)).toBe(false);
});
