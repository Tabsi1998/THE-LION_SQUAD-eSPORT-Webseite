import { countWord, documentVisibility, timesDone } from "@/lib/adminWords";

// Wortliste der Verwaltung (#1367, #1378 - Grundstock für #1377): Zahl und Wort in richtiger Ein- und Mehrzahl,
// Werte aus der Datenbank als Wörter.

test("Zahl und Wort: 0 und viele in der Mehrzahl, 1 in der Einzahl", () => {
  expect(countWord(0, "Streitfall", "Streitfälle")).toBe("0 Streitfälle");
  expect(countWord(1, "Streitfall", "Streitfälle")).toBe("1 Streitfall");
  expect(countWord(2, "Vertrag", "Verträge")).toBe("2 Verträge");
  expect(countWord(1, "offener Antrag", "offene Anträge")).toBe("1 offener Antrag");
  // Fehlt die Zahl, steht 0 - nie „undefined“ oder „NaN“.
  expect(countWord(undefined, "Konto", "Konten")).toBe("0 Konten");
  expect(countWord("3", "Konto", "Konten")).toBe("3 Konten");
});

test("„-mal“-Sätze: 1-mal, 3-mal, 0-mal", () => {
  expect(timesDone(1, "angesehen")).toBe("1-mal angesehen");
  expect(timesDone(3, "heruntergeladen")).toBe("3-mal heruntergeladen");
  expect(timesDone(0, "angesehen")).toBe("0-mal angesehen");
  expect(timesDone(null, "angesehen")).toBe("0-mal angesehen");
});

test("Sichtbarkeit eines Dokuments: Alle, Mitglieder, Vorstand - nie der Rohwert", () => {
  expect(documentVisibility("public").label).toBe("Alle");
  expect(documentVisibility("members").label).toBe("Mitglieder");
  expect(documentVisibility("internal").label).toBe("Vorstand");
  expect(documentVisibility("PUBLIC").label).toBe("Alle");
  // Unbekannt: ein Wort statt des Rohwerts.
  expect(documentVisibility("irgendwas").label).toBe("Unbekannt");
  expect(documentVisibility(undefined).label).toBe("Unbekannt");
});
