import { defaultPinUntil, pinState, pinUntilText, shiftDay, viennaToday } from "./newsPin";

// Angeheftete News laufen ab (#1263): Wiener Tage, 14 Tage Vorschlag, Stand für die Verwaltung.

test("der Vorschlag ist heute + 14 Tage am Wiener Kalender", () => {
  // 7.10. 23:30 UTC ist in Wien schon der 8.10.
  expect(viennaToday(new Date("2026-10-07T23:30:00Z"))).toBe("2026-10-08");
  expect(defaultPinUntil(new Date("2026-10-07T23:30:00Z"))).toBe("2026-10-22");
  // Über die Zeitumstellung (25.10.) zählt der Kalender, nicht 24-Stunden-Schritte.
  expect(shiftDay("2026-10-20", 14)).toBe("2026-11-03");
});

test("das Ende als Text und der Stand je Beitrag", () => {
  expect(pinUntilText("2026-10-21")).toBe("bis 21.10.2026");
  expect(pinUntilText("")).toBe("");
  const now = new Date("2026-10-21T21:59:00Z");
  expect(pinState({ pinned: true, pinned_until: "2026-10-21" }, now)).toEqual({ active: true, until: "2026-10-21", text: "bis 21.10.2026" });
  expect(pinState({ pinned: true, pinned_until: "2026-10-21" }, new Date("2026-10-21T22:00:00Z")).active).toBe(false);
  expect(pinState({ pinned: true, pinned_until: "2026-10-30", pin_active: false }, now).active).toBe(false);
  expect(pinState({ pinned: false, pinned_until: "2026-10-30" }, now)).toBeNull();
});
