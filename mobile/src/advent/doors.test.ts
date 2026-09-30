import { dayLabel } from "./doors";

// Was nur die App braucht (#642): der Tag eines Events oder einer News als Text - nach der Uhr in Wien, weil `Intl`
// mit Zeitzonen nicht auf jedem Gerät da ist. Die gemeinsame Rechnung mit dem Web prüft parity.test.ts.

test("der Tag als Text - nach der Uhr in Wien", () => {
  expect(dayLabel("2026-12-19T18:00:00+01:00")).toBe("19. Dezember 2026");
  expect(dayLabel("2026-12-05T05:00:00Z")).toBe("5. Dezember 2026");
  // Kurz vor Mitternacht UTC ist in Wien schon der nächste Tag - und zu Silvester das nächste Jahr.
  expect(dayLabel("2026-12-31T23:30:00Z")).toBe("1. Jänner 2027");
  expect(dayLabel("2026-07-31T22:00:00Z")).toBe("1. August 2026");
  expect(dayLabel("irgendwann")).toBe("");
  expect(dayLabel(null)).toBe("");
  expect(dayLabel(undefined)).toBe("");
});
