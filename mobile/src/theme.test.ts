import { KIND_COLORS } from "./components/MonthCalendar";
import { colors, kindColors, roles, radius } from "./theme";

// Farben je Art an einer Stelle (#1151, #1305): der Kalender nimmt sie aus dem Thema - Event Violett, Turnier Cyan,
// Fast Lap Türkis, Verein Gold, wie auf den Karten und im Web (der Gleichheits-Test mit dem Web steht in
// frontend/src/lib/categoryColors.test.js).

test("Kalender: Farben je Art aus dem Thema, nach Rolle", () => {
  expect(KIND_COLORS).toEqual(kindColors);
  expect(kindColors).toEqual({ event: roles.event, tournament: roles.brand, fastlap: "#2DD4BF", club: roles.honor });
  expect(new Set(Object.values(kindColors)).size).toBe(4);
});

test("Rollen: Grün ist das weiche #1FD08E, Orange gibt es für „Achtung“", () => {
  expect(colors.success).toBe(roles.ok);
  expect(roles.ok).toBe("#1FD08E");
  expect(roles.warn).toBe("#FF9F43");
  expect(roles.live).toBe(colors.live);
  expect(roles.honor).toBe(colors.gold);
});

test("Ecken: Karten, Knöpfe und Schilder mit dem Grundwert des Webs", () => {
  expect(radius).toEqual({ sm: 2, md: 2, lg: 2 });
});
