import { dayLabel, publishModeSentence, publishText, validityText } from "./referenceSeriesStaff";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“.
runAtTestClock();

// Captains externer Serien (#1749): nur Beschriftung - ob ein Recht gilt, sagt der Server (is_valid).
test("Tage als TT.MM.JJJJ, ohne gültigen Tag leer", () => {
  expect(dayLabel("2026-12-31")).toBe("Do 31. Dezember");
  expect(dayLabel("2026-03-29")).toBe("So 29. März");
  expect(dayLabel("")).toBe("");
  expect(dayLabel("irgendwann")).toBe("");
});

test("Ablauf: gilt bis, abgelaufen am, ohne Tag gilt nichts", () => {
  expect(validityText({ valid_until: "2026-12-31", is_valid: true })).toBe("gilt bis Do 31. Dezember");
  expect(validityText({ valid_until: "2026-01-31", is_valid: false })).toBe("abgelaufen am Sa 31. Jänner");
  expect(validityText({ valid_until: null })).toBe("ohne gültigen Ablauf – gilt nicht");
});

test("Entwurf oder direkt", () => {
  expect(publishText(false)).toBe("Einträge sind Entwürfe, der Vorstand gibt frei");
  expect(publishText(true)).toBe("veröffentlicht direkt");
  expect(publishModeSentence("review")).toContain("Entwürfe");
  expect(publishModeSentence("direct")).toContain("direkt");
});
