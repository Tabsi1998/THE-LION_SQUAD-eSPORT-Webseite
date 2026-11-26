import FRAGEN from "./fragen.json";

// Die Fragen gehen als Kopie in die App (mobile/scripts/sync-faq.js). Die App öffnet Links über targetFromUrl und kennt
// /mein-bereich noch nicht - bis das App-Paket von #2059 kommt, nennen die Fragen die alten Adressen, die die Website
// ohnehin nach Mein Bereich weiterleitet (Entscheidung 26.11., wie bei Mails und Push).
test("FAQ-Fragen verlinken vorerst keine /mein-bereich-Adresse", () => {
  const neue = FRAGEN.filter((frage) => String(frage.link?.to || "").startsWith("/mein-bereich")).map((frage) => frage.id);
  expect(neue).toEqual([]);
});
