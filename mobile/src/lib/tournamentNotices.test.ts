import {
  activeNotices,
  deliveryText,
  newRequestId,
  nextExpiry,
  noticeClock,
  noticeLength,
  noticeTemplates,
  recipientsText,
  remainingShare,
  remainingText,
  suggestedPauseClock,
} from "./tournamentNotices";

// Hinweis der Turnierleitung (#1166, #2393): dieselben Fälle wie im Web (frontend/src/lib/tournamentNotices.test.js) -
// Vorlagen, Restzeit, was noch steht, Versand in einem Satz.

const NOW = Date.parse("2026-11-14T13:07:00Z"); // 14:07 in Wien (Winterzeit)

describe("Vorlagen", () => {
  test("schlägt für „Pause bis“ eine Viertelstunde später vor, auf fünf Minuten aufgerundet", () => {
    expect(suggestedPauseClock(NOW)).toBe("14:25");
    const [pause, final, checkin] = noticeTemplates({ now: NOW, station: "PS5 · 2" });
    expect(pause.text).toBe("Pause bis 14:25");
    expect(final.text).toBe("Finale an PS5 · 2");
    expect(checkin.text).toBe("Bitte zum Check-in");
    expect(noticeTemplates({ now: NOW })[1].text).toBe("Finale an PC 1");
  });
});

describe("Ablauf", () => {
  const item = (id: string, created: string, expires: string) => ({ id, text: `Hinweis ${id}`, created_at: created, expires_at: expires });
  const standing = item("a", "2026-11-14T13:00:00Z", "2026-11-14T15:00:00Z");
  const older = item("b", "2026-11-14T12:30:00Z", "2026-11-14T13:20:00Z");
  const gone = item("c", "2026-11-14T10:00:00Z", "2026-11-14T12:00:00Z");

  test("zeigt nur, was noch steht - den neuesten zuerst", () => {
    expect(activeNotices([older, gone, standing], NOW).map((row) => row.id)).toEqual(["a", "b"]);
    expect(activeNotices(null, NOW)).toEqual([]);
    expect(activeNotices([{ id: "leer", text: "", expires_at: "2026-11-14T15:00:00Z" }], NOW)).toEqual([]);
    expect(nextExpiry([standing, older, gone], NOW)).toBe(13 * 60000);
    expect(nextExpiry([gone], NOW)).toBeNull();
  });

  test("sagt die Restzeit in Worten und als Anteil", () => {
    expect(remainingText(standing.expires_at, NOW)).toBe("noch 1 Std. 53 Min.");
    expect(remainingText(older.expires_at, NOW)).toBe("noch 13 Min.");
    expect(remainingText("2026-11-14T15:07:00Z", NOW)).toBe("noch 2 Std.");
    expect(remainingText(gone.expires_at, NOW)).toBe("läuft gleich ab");
    expect(remainingShare(standing, NOW)).toBeCloseTo(113 / 120, 5);
    expect(remainingShare(gone, NOW)).toBe(0);
    expect(remainingShare({ id: "x" }, NOW)).toBe(0);
    expect(noticeClock(standing)).toBe("14:00");
  });
});

describe("Formular und Protokoll", () => {
  test("zählt Zeichen wie der Server (Leerraum zusammengefasst)", () => {
    expect(noticeLength("  Pause   bis\n14:30 ")).toBe(15);
    expect(noticeLength("")).toBe(0);
  });

  test("fasst Empfänger und Versand in einem Satz", () => {
    expect(recipientsText(null)).toBe("Empfänger werden gezählt …");
    expect(recipientsText(0)).toContain("nur als Banner");
    expect(recipientsText(1)).toBe("Geht an 1 Person: alle Angemeldeten, bei Teams alle Mitglieder.");
    expect(deliveryText({ id: "1", state: "sent", recipients: 12, delivered: 11 })).toBe("an 12 Personen · 11 benachrichtigt");
    expect(deliveryText({ id: "1", state: "sent", recipients: 1, delivered: 1 })).toBe("an 1 Person · 1 benachrichtigt");
    expect(deliveryText({ id: "1", state: "sending", recipients: 40, processed: 7 })).toBe("wird verschickt · 7 von 40 Personen");
    expect(deliveryText({ id: "1", state: "sending", stale: true, recipients: 40, processed: 7 })).toBe("Versand unterbrochen · 7 von 40 Personen – bitte fortsetzen");
    expect(deliveryText({ id: "1", state: "interrupted", recipients: 3, processed: 2, failed: 1 })).toBe("Versand unterbrochen · 2 von 3 Personen · bei 1 Person hat es geklemmt – bitte fortsetzen");
  });

  test("gibt jedem Hinweis eine eigene Kennung", () => {
    const first = newRequestId();
    expect(first.startsWith("notice-")).toBe(true);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(newRequestId()).not.toBe(first);
  });
});
