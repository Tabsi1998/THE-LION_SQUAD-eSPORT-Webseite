import type { AchievementGroup } from "../../lib/achievements";
import { MAX_PINS, NO_FILTERS, achievementStats, applyTierFilters, categoryProgress, hasFilters, movePin, prestigeUndoUntil, shareIdsByCode, togglePin } from "./model";

// Regeln des Erfolge-Reiters (E13, #623) - dieselben wie im Web (#619).

const tier = (code: string, material: string, extra: Record<string, unknown> = {}) => ({ code, name: code, material, rank: 1, points: 5, earned: false, current: 0, target: 10, ...extra });

const GROUPS: AchievementGroup[] = [
  { code: "play", name: "Spielmacher", category: "match", tiers: [tier("play_1", "wood", { earned: true }), tier("play_2", "iron", { earned: true }), tier("play_3", "bronze", { current: 4 })] },
  { code: "laps", name: "Rundenjäger", category: "fastlap", tiers: [tier("laps_1", "wood")] },
  { code: "door", name: "Geheimtür", category: "hidden", hidden: true, tiers: [tier("door_1", "hidden", { earned: true })] },
  { code: "oops", name: "Hoppla", category: "negative", is_negative: true, tiers: [tier("oops_1", "wood", { earned: true })] },
];

test("Vitrinen zählen je Kategorie in Web-Reihenfolge, Negatives nie", () => {
  expect(categoryProgress(GROUPS).map((row) => [row.key, row.label, row.earned, row.total])).toEqual([
    ["match", "Spielen", 2, 3],
    ["fastlap", "Fast Lap", 0, 1],
    ["hidden", "Geheim", 1, 1],
  ]);
});

test("Filter nach Status, Material und Kategorie - der Fortschritt behält alle Stufen", () => {
  expect(applyTierFilters(GROUPS, NO_FILTERS)).toBe(GROUPS);
  expect(hasFilters(NO_FILTERS)).toBe(false);
  const earned = applyTierFilters(GROUPS, { ...NO_FILTERS, status: "earned" });
  expect(earned.map((group) => group.code)).toEqual(["play", "oops"]);
  expect(earned[0].tiers!.map((t) => t.code)).toEqual(["play_1", "play_2"]);
  expect(earned[0].all_tiers!.map((t) => t.code)).toEqual(["play_1", "play_2", "play_3"]);
  expect(applyTierFilters(GROUPS, { ...NO_FILTERS, status: "progress" }).map((group) => group.code)).toEqual(["play"]);
  expect(applyTierFilters(GROUPS, { ...NO_FILTERS, status: "secret" }).map((group) => group.code)).toEqual(["door"]);
  expect(applyTierFilters(GROUPS, { ...NO_FILTERS, material: "wood" }).map((group) => group.code)).toEqual(["play", "laps", "oops"]);
  expect(applyTierFilters(GROUPS, { ...NO_FILTERS, category: "fastlap" }).map((group) => group.code)).toEqual(["laps"]);
  expect(hasFilters({ ...NO_FILTERS, category: "fastlap" })).toBe(true);
});

test("Anheften bis sechs, Lösen jederzeit, Reihenfolge mit Pfeilen", () => {
  expect(togglePin(["a"], "b")).toEqual({ codes: ["a", "b"], full: false });
  expect(togglePin(["a", "b"], "a")).toEqual({ codes: ["b"], full: false });
  const six = ["a", "b", "c", "d", "e", "f"];
  expect(MAX_PINS).toBe(6);
  expect(togglePin(six, "g")).toEqual({ codes: six, full: true });
  expect(togglePin(six, "c").codes).toEqual(["a", "b", "d", "e", "f"]);
  expect(movePin(["a", "b", "c"], "b", -1)).toEqual(["b", "a", "c"]);
  expect(movePin(["a", "b", "c"], "b", 1)).toEqual(["a", "c", "b"]);
  expect(movePin(["a", "b", "c"], "a", -1)).toEqual(["a", "b", "c"]);
  expect(movePin(["a", "b", "c"], "x", 1)).toEqual(["a", "b", "c"]);
});

test("Zahlen, Teilen-Kennungen und die Frist der Prestige-Rücknahme", () => {
  const data = { groups: GROUPS, awards: [{ code: "play_1", award_id: "aw1", points: 5 }, { code: "play_2", award_id: "aw2", points: 10 }, { code: "oops_1", award_id: "aw3", points: 0, is_negative: true }, { code: "club_1", award_id: "aw4", points: 20, member_only: true }] };
  expect(achievementStats(data)).toEqual({ earned: 4, total: 6, points: 35, earnedPercent: 67 });
  expect(achievementStats(null)).toEqual({ earned: 0, total: 0, points: 0, earnedPercent: 0 });
  expect(shareIdsByCode(data)).toEqual({ play_1: "aw1", play_2: "aw2" });
  const now = Date.parse("2026-10-03T12:00:00Z");
  expect(prestigeUndoUntil({ prestige_undo_until: "2026-10-04T11:00:00+00:00" }, now)?.toISOString()).toBe("2026-10-04T11:00:00.000Z");
  expect(prestigeUndoUntil({ prestige_undo_until: "2026-10-03T11:00:00+00:00" }, now)).toBeNull();
  expect(prestigeUndoUntil({ prestige_undo_until: null }, now)).toBeNull();
  expect(prestigeUndoUntil(null, now)).toBeNull();
});
