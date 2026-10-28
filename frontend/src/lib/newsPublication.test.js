import { initialPublishMode, needsPublishQuestion, newsPublicationState, publishFields, publishQuestion } from "./newsPublication";

// Wann erscheint ein Beitrag (#2122 NW1): neu ist Entwurf, veröffentlicht wird bewusst - mit Rückfrage.

const NOW = Date.parse("2026-10-28T12:00:00Z");

test("Stand beim Öffnen: neu und zurückgezogen sind Entwürfe, Termin in der Zukunft ist geplant", () => {
  expect(initialPublishMode({}, NOW)).toBe("draft");
  expect(initialPublishMode({ id: "n", published: true, withdrawn_at: "2026-10-01" }, NOW)).toBe("draft");
  expect(initialPublishMode({ id: "n", published: false, published_at: "2026-11-01T10:00:00Z" }, NOW)).toBe("draft");
  expect(initialPublishMode({ id: "n", published: true, published_at: "2026-11-01T10:00:00Z" }, NOW)).toBe("scheduled");
  expect(initialPublishMode({ id: "n", published: true, published_at: "2026-10-01T10:00:00Z" }, NOW)).toBe("now");
  expect(initialPublishMode({ id: "n", published: true }, NOW)).toBe("now");
});

test("was gespeichert wird: Entwurf behält ein altes Datum, „Jetzt“ setzt jetzt, ein Veröffentlichter behält seins", () => {
  expect(publishFields("draft", "", "draft", { published_at: "2026-11-01T11:00" }, NOW)).toEqual({ published: false, published_at: "2026-11-01T11:00" });
  expect(publishFields("now", "", "draft", {}, NOW)).toEqual({ published: true, published_at: "2026-10-28T12:00:00.000Z" });
  expect(publishFields("now", "", "scheduled", { published_at: "2026-11-01T11:00" }, NOW)).toEqual({ published: true, published_at: "2026-10-28T12:00:00.000Z" });
  expect(publishFields("now", "", "now", { published_at: "2026-09-01T11:00" }, NOW)).toEqual({ published: true, published_at: "2026-09-01T11:00" });
  expect(publishFields("scheduled", "2026-11-10T18:00:00Z", "draft", {}, NOW)).toEqual({ published: true, published_at: "2026-11-10T18:00:00Z" });
  expect(publishFields("scheduled", "", "draft", {}, NOW).error).toMatch(/Termin/);
  expect(publishFields("scheduled", "2026-10-01T10:00:00Z", "draft", {}, NOW).error).toMatch(/Vergangenheit/);
});

test("Rückfrage nur, wenn der Beitrag dadurch hinausgeht oder geplant wird", () => {
  expect(needsPublishQuestion("draft", "draft")).toBe(false);
  expect(needsPublishQuestion("now", "draft")).toBe(true);
  expect(needsPublishQuestion("scheduled", "draft")).toBe(true);
  expect(needsPublishQuestion("now", "scheduled")).toBe(true);
  expect(needsPublishQuestion("now", "now")).toBe(false);
  expect(needsPublishQuestion("scheduled", "scheduled")).toBe(false);
});

test("Rückfrage-Texte: Empfänger, intern, schon verschickt, Mitglieder-Meldung, geplant", () => {
  expect(publishQuestion({ mode: "now", audience: { recipients: 1, internal: false, visibility: "public" }, discord: false }).description)
    .toBe("Der Newsletter geht sofort an 1 Person mit Newsletter-Zustimmung. Keine Meldung auf Discord.");
  expect(publishQuestion({ mode: "now", audience: { recipients: 0, internal: true, visibility: "internal", announcement: "Die Vereinsverwaltung bekommt eine Meldung." } }).description)
    .toBe("Kein Newsletter – „Nur intern“ geht nicht per Mail hinaus. Die Vereinsverwaltung bekommt eine Meldung.");
  expect(publishQuestion({ mode: "now", sentAt: "2026-10-01", sentText: "01.10.2026" }).description).toBe("Der Newsletter ging schon am 01.10.2026 hinaus – kein zweites Mal.");
  const planned = publishQuestion({ mode: "scheduled", whenText: "10.11.2026, 18:00", audience: { recipients: 40, visibility: "public" }, discord: true });
  expect(planned.title).toBe("Beitrag für 10.11.2026, 18:00 planen?");
  expect(planned.confirmLabel).toBe("Planen");
  expect(planned.description).toBe("Zum Termin geht der Newsletter an 40 Personen mit Newsletter-Zustimmung (Stand jetzt). Discord bekommt zum Termin eine Meldung.");
  expect(publishQuestion({ mode: "now" }).description).toBe("Der Newsletter geht sofort an alle mit Newsletter-Zustimmung.");
});

test("Stand in der Liste: zurückgezogen vor Entwurf vor geplant", () => {
  expect(newsPublicationState({ published: false, withdrawn_at: "x" }, NOW).key).toBe("withdrawn");
  expect(newsPublicationState({ published: false }, NOW).key).toBe("draft");
  expect(newsPublicationState({ published: true, published_at: "2026-11-01T00:00:00Z" }, NOW).key).toBe("scheduled");
  expect(newsPublicationState({ published: true, published_at: "2026-10-01T00:00:00Z" }, NOW).key).toBe("published");
});
