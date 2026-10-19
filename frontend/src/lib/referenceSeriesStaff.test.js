import { dayLabel, publishModeSentence, publishText, validityText } from "./referenceSeriesStaff";

// Captains externer Serien (#1749): nur Beschriftung - ob ein Recht gilt, sagt der Server (is_valid).
test("Tage als TT.MM.JJJJ, ohne gültigen Tag leer", () => {
  expect(dayLabel("2026-12-31")).toBe("31.12.2026");
  expect(dayLabel("2026-03-29")).toBe("29.03.2026");
  expect(dayLabel("")).toBe("");
  expect(dayLabel("irgendwann")).toBe("");
});

test("Ablauf: gilt bis, abgelaufen am, ohne Tag gilt nichts", () => {
  expect(validityText({ valid_until: "2026-12-31", is_valid: true })).toBe("gilt bis 31.12.2026");
  expect(validityText({ valid_until: "2026-01-31", is_valid: false })).toBe("abgelaufen am 31.01.2026");
  expect(validityText({ valid_until: null })).toBe("ohne gültigen Ablauf – gilt nicht");
});

test("Entwurf oder direkt", () => {
  expect(publishText(false)).toBe("Einträge sind Entwürfe, der Vorstand gibt frei");
  expect(publishText(true)).toBe("veröffentlicht direkt");
  expect(publishModeSentence("review")).toContain("Entwürfe");
  expect(publishModeSentence("direct")).toContain("direkt");
});
