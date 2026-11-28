import { formatAdminDate } from "./adminListTools";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): Samstag, 28.11.2026 - der Tag darauf wäre in der Anzeige „morgen“.
runAtTestClock();

// CSV-Spalten (#1307, Review-Befund 1): das amtliche Datum mit Jahr - nie „morgen“ oder ein Wochentag, sonst lässt sich
// die Datei nicht sortieren und ist nach dem Jahreswechsel mehrdeutig.
test("formatAdminDate schreibt für CSV das amtliche Datum", () => {
  expect(formatAdminDate("2026-11-29T10:00:00Z")).toBe("29.11.2026");
  expect(formatAdminDate("2026-12-31T23:30:00Z")).toBe("01.01.2027");
  expect(formatAdminDate("2026-03-14")).toBe("14.03.2026");
  expect(formatAdminDate(null)).toBe("");
  expect(formatAdminDate("kaputt")).toBe("");
});
