import { defaultPinUntil, pinBaseDay, pinState, pinUntilText, shiftDay, viennaToday } from "./newsPin";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“.
runAtTestClock();

// Angeheftete News laufen ab (#1263): Wiener Tage, 14 Tage Vorschlag, Stand für die Verwaltung.

test("der Vorschlag ist heute + 14 Tage am Wiener Kalender", () => {
  // 7.10. 23:30 UTC ist in Wien schon der 8.10.
  expect(viennaToday(new Date("2026-10-07T23:30:00Z"))).toBe("2026-10-08");
  expect(defaultPinUntil(new Date("2026-10-07T23:30:00Z"))).toBe("2026-10-22");
  // Über die Zeitumstellung (25.10.) zählt der Kalender, nicht 24-Stunden-Schritte.
  expect(shiftDay("2026-10-20", 14)).toBe("2026-11-03");
});

test("das Ende als Text und der Stand je Beitrag", () => {
  expect(pinUntilText("2026-10-21")).toBe("bis Mi 21. Oktober");
  expect(pinUntilText("")).toBe("");
  const now = new Date("2026-10-21T21:59:00Z");
  expect(pinState({ pinned: true, pinned_until: "2026-10-21" }, now)).toEqual({ active: true, until: "2026-10-21", text: "bis Mi 21. Oktober" });
  expect(pinState({ pinned: true, pinned_until: "2026-10-21" }, new Date("2026-10-21T22:00:00Z")).active).toBe(false);
  expect(pinState({ pinned: true, pinned_until: "2026-10-30", pin_active: false }, now).active).toBe(false);
  expect(pinState({ pinned: false, pinned_until: "2026-10-30" }, now)).toBeNull();
});

test("geplanter Beitrag: Vorschlag ab dem Termin, nie vor heute", () => {
  const now = new Date("2026-10-07T10:00:00Z");
  expect(pinBaseDay("2026-10-28T09:00:00Z", now)).toBe("2026-10-28");
  expect(pinBaseDay("2026-09-01T09:00:00Z", now)).toBe("2026-10-07");
  expect(pinBaseDay(null, now)).toBe("2026-10-07");
  expect(defaultPinUntil(now, "2026-10-28T09:00:00Z")).toBe("2026-11-11");
  expect(pinState({ pinned: true, pin_until: "2026-10-30", pin_active: true }, now)).toEqual({ active: true, until: "2026-10-30", text: "bis Fr 30. Oktober" });
});
