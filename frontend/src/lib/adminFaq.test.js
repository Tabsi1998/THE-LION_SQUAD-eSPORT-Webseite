import { FAQ_TOPICS, faqQuestions, filterFaq } from "./adminFaq";
import { SETUP_GUIDES } from "./setupGuides";

// Jede Frage hat Antwort, Weg in den Admin und - wenn genannt - eine vorhandene Anleitung; Schlüssel sind eindeutig.
test("Fragen sind vollständig, Wege zeigen in den Admin, Anleitungen gibt es", () => {
  const questions = faqQuestions();
  expect(questions.length).toBeGreaterThan(40);
  const keys = questions.map((q) => q.key);
  expect(new Set(keys).size).toBe(keys.length);
  for (const question of questions) {
    expect(question.q.endsWith("?")).toBe(true);
    expect(question.a.length).toBeGreaterThan(20);
    expect(question.to.startsWith("/")).toBe(true);
    expect(question.label.length).toBeGreaterThan(3);
    if (question.guide) expect(SETUP_GUIDES[question.guide]).toBeTruthy();
  }
  expect(FAQ_TOPICS.map((topic) => topic.key)).toEqual(["verein", "mitglieder", "dolibarr", "esports", "discord", "email", "konten", "content", "app", "betrieb"]);
});

test("die Suche findet über Frage, Antwort und Weg - alle Wörter müssen passen", () => {
  expect(filterFaq("").length).toBe(FAQ_TOPICS.length);
  const hit = filterFaq("Webhook dolibarr");
  expect(hit.map((topic) => topic.key)).toEqual(["dolibarr"]);
  expect(hit[0].questions.map((q) => q.key)).toContain("webhook");
  expect(hit[0].questions.map((q) => q.key)).not.toContain("turnier");
  expect(filterFaq("Steuersätze")[0].questions[0].key).toBe("rechnungen");
  expect(filterFaq("gibt es nicht xyz")).toEqual([]);
});
