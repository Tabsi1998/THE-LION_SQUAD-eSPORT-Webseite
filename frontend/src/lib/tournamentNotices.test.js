import {
  activeNotices,
  deliveryText,
  newRequestId,
  nextExpiry,
  noticeLength,
  noticeTemplates,
  pauseClockIn,
  pauseUntilIso,
  remainingShare,
  remainingText,
  suggestedPauseClock,
} from "./tournamentNotices";

// Hinweis der Turnierleitung (#1166): Vorlagen, „Pause bis“, Restzeit und was noch steht.

const NOW = Date.parse("2026-11-14T13:07:00Z"); // 14:07 in Wien (Winterzeit)

describe("Vorlagen und Pause bis", () => {
  it("schlägt für „Pause bis“ eine Viertelstunde später vor, auf fünf Minuten aufgerundet", () => {
    expect(suggestedPauseClock(NOW)).toBe("14:25");
    const [pause, final, checkin] = noticeTemplates({ now: NOW, station: "PS5 · 2" });
    expect(pause.text).toBe("Pause bis 14:25");
    expect(final.text).toBe("Finale an PS5 · 2");
    expect(checkin.text).toBe("Bitte zum Check-in");
    expect(noticeTemplates({ now: NOW })[1].text).toBe("Finale an PC 1");
  });

  it("liest die Uhrzeit aus „Pause bis 14:30“ und rechnet sie als Wiener Zeit", () => {
    expect(pauseClockIn("Pause bis 14:30, dann Finale")).toBe("14:30");
    expect(pauseClockIn("Finale an PC 1")).toBe("");
    expect(pauseUntilIso("14:30", NOW)).toBe("2026-11-14T13:30:00.000Z");
    // Liegt die Zeit mehr als eine Stunde zurück, ist morgen gemeint.
    expect(pauseUntilIso("01:15", NOW)).toBe("2026-11-15T00:15:00.000Z");
    expect(pauseUntilIso("25:00", NOW)).toBeNull();
    expect(pauseUntilIso("bald", NOW)).toBeNull();
  });
});

describe("Ablauf", () => {
  const item = (id, created, expires) => ({ id, text: `Hinweis ${id}`, created_at: created, expires_at: expires });
  const standing = item("a", "2026-11-14T13:00:00Z", "2026-11-14T15:00:00Z");
  const older = item("b", "2026-11-14T12:30:00Z", "2026-11-14T13:20:00Z");
  const gone = item("c", "2026-11-14T10:00:00Z", "2026-11-14T12:00:00Z");

  it("zeigt nur, was noch steht - den neuesten zuerst", () => {
    expect(activeNotices([older, gone, standing], NOW).map((row) => row.id)).toEqual(["a", "b"]);
    expect(activeNotices(null, NOW)).toEqual([]);
    expect(nextExpiry([standing, older, gone], NOW)).toBe(13 * 60000);
    expect(nextExpiry([gone], NOW)).toBeNull();
  });

  it("sagt die Restzeit in Worten und als Anteil", () => {
    expect(remainingText(standing.expires_at, NOW)).toBe("noch 1 Std. 53 Min.");
    expect(remainingText(older.expires_at, NOW)).toBe("noch 13 Min.");
    expect(remainingText("2026-11-14T15:07:00Z", NOW)).toBe("noch 2 Std.");
    expect(remainingText(gone.expires_at, NOW)).toBe("läuft gleich ab");
    expect(remainingShare(standing, NOW)).toBeCloseTo(113 / 120, 5);
    expect(remainingShare(gone, NOW)).toBe(0);
    expect(remainingShare({}, NOW)).toBe(0);
  });
});

describe("Formular und Protokoll", () => {
  it("zählt Zeichen wie der Server (Leerraum zusammengefasst)", () => {
    expect(noticeLength("  Pause   bis\n14:30 ")).toBe(15);
    expect(noticeLength("")).toBe(0);
  });

  it("fasst den Versand in einem Satz", () => {
    expect(deliveryText({ state: "sent", recipients: 12, delivered: 11 })).toBe("an 12 Personen · 11 benachrichtigt");
    expect(deliveryText({ state: "sent", recipients: 1, delivered: 1 })).toBe("an 1 Person · 1 benachrichtigt");
    expect(deliveryText({ state: "sending", recipients: 40, processed: 7 })).toBe("wird verschickt · 7 von 40 Personen");
    expect(deliveryText({ state: "sending", stale: true, recipients: 40, processed: 7 })).toBe("Versand unterbrochen · 7 von 40 Personen – bitte fortsetzen");
    expect(deliveryText({ state: "interrupted", recipients: 3, processed: 2, failed: 1 })).toBe("Versand unterbrochen · 2 von 3 Personen · bei 1 Person hat es geklemmt – bitte fortsetzen");
  });

  it("gibt jedem Hinweis eine eigene Kennung", () => {
    const first = newRequestId();
    expect(first).toMatch(/^notice-/);
    expect(first.length).toBeGreaterThanOrEqual(8);
    expect(newRequestId()).not.toBe(first);
  });
});
