import { KIND_COLORS } from "./components/MonthCalendar";
import { colors, kindColors, radius } from "./theme";

// Farben je Art an einer Stelle (#1151): der Kalender nimmt sie aus dem Thema - Events lila, Turniere gold, Fast Laps
// blau, wie auf den Karten und im Web (der Gleichheits-Test mit dem Web steht in frontend/src/lib/categoryColors.test.js).

test("Kalender: Farben je Art aus dem Thema", () => {
  expect(KIND_COLORS).toEqual(kindColors);
  // Versammlungen und eigene Schichten (#1190) sind grün, nicht gold - Gold heißt „angemeldet“.
  expect(KIND_COLORS.club).not.toBe(colors.gold);
  expect(kindColors.event).not.toBe(kindColors.fastlap);
});

test("Ecken: Karten, Knöpfe und Schilder mit dem Grundwert des Webs", () => {
  expect(radius).toEqual({ sm: 2, md: 2, lg: 2 });
});
