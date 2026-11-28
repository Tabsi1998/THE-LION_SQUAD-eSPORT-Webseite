import { chosenOf, pollChip, pollDeadlineText, pollHiddenText, pollRuleText, toggleChoice } from "./eventPolls";

// Abstimmung im Event (#2612): Wörter und Regeln der Karte auf der Event-Seite - Frist in Wiener Zeit, Schild je Stand.

const NOW = new Date("2026-12-20T10:00:00Z");
const OPEN = { status: "open", max_choices: 1, results_visibility: "live", closes_at: "2026-12-23T17:00:00+00:00", rights: [] };

test("Schild: offen, schon abgestimmt, beendet", () => {
  expect(pollChip(OPEN)).toEqual({ kind: "soon", label: "Offen" });
  expect(pollChip({ ...OPEN, rights: [{ state: "used" }] })).toEqual({ kind: "joined", label: "Abgestimmt" });
  expect(pollChip({ ...OPEN, status: "closed", rights: [{ state: "used" }] })).toEqual({ kind: "done", label: "Beendet" });
});

test("Frist in Wiener Zeit, ohne Frist offen bis zum Beenden", () => {
  expect(pollDeadlineText(OPEN, NOW)).toBe("Abstimmen bis Mi 23. Dezember · 18:00");
  expect(pollDeadlineText({ ...OPEN, closes_at: "2026-12-20T17:30:00Z" }, NOW)).toBe("Abstimmen bis heute 18:30");
  expect(pollDeadlineText({ ...OPEN, closes_at: null }, NOW)).toBe("Offen, bis die Verwaltung sie beendet");
  expect(pollDeadlineText({ ...OPEN, status: "closed" }, NOW)).toBe("Beendet seit Mi 23. Dezember · 18:00");
  expect(pollDeadlineText({ ...OPEN, status: "closed", closes_at: null, closed_at: "2026-12-19T09:00:00Z" }, NOW)).toBe("Beendet seit Sa 19. Dezember · 10:00");
});

test("Regel: eine oder mehrere Antworten, Ergebnis sofort oder nach der Frist", () => {
  expect(pollRuleText(OPEN)).toBe("Eine Antwort · Ergebnis sofort sichtbar");
  expect(pollRuleText({ ...OPEN, max_choices: 2, results_visibility: "after_close" })).toBe("Bis zu 2 Antworten · Ergebnis nach der Frist");
  expect(pollRuleText({ ...OPEN, max_choices: 3, results_visibility: "after_close", closes_at: null })).toBe("Bis zu 3 Antworten · Ergebnis nach dem Ende");
});

test("verdecktes Ergebnis sagt, wann es kommt", () => {
  expect(pollHiddenText(OPEN, NOW)).toBe("Das Ergebnis erscheint nach der Frist (Mi 23. Dezember · 18:00).");
  expect(pollHiddenText({ ...OPEN, closes_at: null }, NOW)).toBe("Das Ergebnis erscheint, sobald die Abstimmung beendet ist.");
});

test("Auswahl: eine Antwort ersetzt, mehrere schalten bis zur Grenze", () => {
  expect(toggleChoice(["a"], "b", 1)).toEqual(["b"]);
  expect(toggleChoice(["a"], "a", 1)).toEqual([]);
  expect(toggleChoice(["a"], "b", 2)).toEqual(["a", "b"]);
  expect(toggleChoice(["a", "b"], "c", 2)).toEqual(["a", "b"]);
  expect(toggleChoice(["a", "b"], "a", 2)).toEqual(["b"]);
  expect(chosenOf({ rights: [{ choices: ["b"] }] })).toEqual(["b"]);
  expect(chosenOf({ rights: [] })).toEqual([]);
});
