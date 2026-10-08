import { boardSentence, clearSentence, postTitle } from "./boardRights";

// Vorstand (#1355): der Satz vor dem Besetzen nennt die Rechte - oder dass sie aus Dolibarr kommen.

const KASSIER = { title_male: "Kassier", title_female: "Kassierin", is_active: true };

test("Bezeichnung eines Postens in einer Zeile", () => {
  expect(postTitle(KASSIER)).toBe("Kassier:in");
  expect(postTitle({ title_male: "Obmann", title_female: "Obfrau" })).toBe("Obmann / Obfrau");
  expect(postTitle({ title_male: "Beirat" })).toBe("Beirat");
});

test("lokal: der Posten bringt die Vereinsverwaltung", () => {
  expect(boardSentence({ person: { name: "Erika Beispiel", has_account: true }, position: KASSIER }))
    .toBe("Erika Beispiel wird Kassier:in und bekommt damit die Vereinsverwaltung: Mitgliederdaten, Anträge, Dokumente, Benutzer. Zwei-Faktor ist dafür Pflicht.");
  expect(boardSentence({ person: { name: "Erika Beispiel" }, position: KASSIER, deputy: true }))
    .toContain("Erika Beispiel wird Vertretung für Kassier:in und bekommt damit die Vereinsverwaltung");
});

test("mit Dolibarr-Funktionen ist der Posten nur für die Anzeige", () => {
  expect(boardSentence({ person: { name: "Erika Beispiel" }, position: KASSIER, rightsFromDolibarr: true }))
    .toBe("Erika Beispiel wird Kassier:in. Der Posten ist nur für die Anzeige – die Rechte kommen aus Dolibarr.");
});

test("ohne Konto oder bei inaktivem Posten keine Rechte - und der Satz sagt es", () => {
  expect(boardSentence({ person: { name: "Mara", has_account: false }, position: KASSIER })).toBe("Mara wird Kassier:in. Ohne Konto auf der Website bringt der Posten keine Rechte.");
  expect(boardSentence({ person: { name: "Mara", has_account: true }, position: { ...KASSIER, is_active: false } })).toContain("gerade inaktiv");
});

test("leeren sagt, dass die Vereinsverwaltung wegfallen kann", () => {
  expect(clearSentence({ holderName: "Leo Löwe", position: KASSIER })).toContain("verliert die Vereinsverwaltung");
  expect(clearSentence({ holderName: "Leo Löwe", position: KASSIER, rightsFromDolibarr: true })).toContain("sie kommen aus Dolibarr");
});
