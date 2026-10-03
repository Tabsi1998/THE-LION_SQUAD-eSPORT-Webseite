import type { AchievementGroup } from "../../lib/achievements";
import { boardParams, catalogStats, earnedOnlyGroups, erfolge, formatPercent, myStats, prestigeStars, sortGroupsByRarity, weekNumber } from "./model";

// Regeln des Schaukastens (E13, #623) - dieselben wie auf /achievements im Web (#619).

const tier = (code: string, extra: Record<string, unknown> = {}) => ({ code, name: code, points: 10, earned: false, ...extra });
const GROUPS: AchievementGroup[] = [
  { code: "a", name: "Alpha", category: "match", tiers: [tier("a1", { earned: true }), tier("a2")] },
  { code: "b", name: "Beta", category: "fastlap", tiers: [tier("b1")] },
  { code: "c", name: "Gamma", category: "team", tiers: [tier("c1", { earned: true }), tier("c2", { earned: true })] },
  { code: "n", name: "Hoppla", category: "negative", is_negative: true, tiers: [tier("n1", { earned: true, points: 0 })] },
];

test("Prozent wie im Web, sehr kleine Werte als „< 0,1 %“", () => {
  expect(formatPercent(12.345)).toBe("12,3 %");
  expect(formatPercent(0.04)).toBe("< 0,1 %");
  expect(formatPercent(0)).toBe("0 %");
  expect(formatPercent(null)).toBe("0 %");
});

test("Kategorie und Zeitraum gelten nur für Erfolgspunkte", () => {
  expect(boardParams({ by: "points", category: "", period: "all" })).toEqual({ limit: 24, by: "points" });
  expect(boardParams({ by: "points", category: "match", period: "month" })).toEqual({ limit: 24, by: "points", category: "match", period: "month" });
  expect(boardParams({ by: "level", category: "match", period: "month" })).toEqual({ limit: 24, by: "level" });
});

test("die seltensten zuerst - Gruppen ohne Angabe ans Ende, Gleichstand nach Personen und Name", () => {
  const rarity = { groups: { a: { holders: 10, top: { percent: 40 } }, b: { holders: 2, top: { percent: 5 } }, c: { holders: 3, top: { percent: 5 } } } };
  expect(sortGroupsByRarity(GROUPS, rarity).map((g) => g.code)).toEqual(["b", "c", "a", "n"]);
  expect(sortGroupsByRarity(GROUPS, null).map((g) => g.code)).toEqual(["a", "b", "c", "n"]);
});

test("öffentliches Profil: nur erreichte Stufen, Gruppen ohne Erreichtes fallen weg", () => {
  const shown = earnedOnlyGroups(GROUPS);
  expect(shown.map((g) => g.code)).toEqual(["a", "c", "n"]);
  expect(shown[0].tiers!.map((t) => t.code)).toEqual(["a1"]);
  // Alle Stufen bleiben für „1 von 2 Stufen“.
  expect(shown[0].all_tiers!.map((t) => t.code)).toEqual(["a1", "a2"]);
  expect(erfolge(1)).toBe("1 Erfolg");
  expect(erfolge(3)).toBe("3 Erfolge");
});

test("Zahlen des Katalogs und die eigenen ohne Negatives; Kalenderwoche und Sterne", () => {
  expect(catalogStats(GROUPS)).toEqual({ tierCount: 5, pointsTotal: 50, categoryCount: 3 });
  expect(myStats(GROUPS)).toEqual({ count: 3, points: 30 });
  expect(myStats(null)).toBeNull();
  expect(weekNumber("2026-W40")).toBe("40");
  expect(weekNumber("2026-W07")).toBe("7");
  expect(weekNumber(null)).toBeNull();
  expect(prestigeStars(2)).toBe("★★");
  expect(prestigeStars(9)).toBe("★★★★★");
  expect(prestigeStars(0)).toBe("");
});
