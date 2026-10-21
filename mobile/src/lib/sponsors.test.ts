import { groupSponsorsByTier, normalizeSponsorTier } from "./sponsors";

// In der App standen alle Sponsoren gleich groß in gleichen Boxen (#244).

test("unbekannte oder fehlende Stufen zählen als Bronze", () => {
  expect(normalizeSponsorTier("gold")).toBe("gold");
  expect(normalizeSponsorTier("MAIN")).toBe("main");
  expect(normalizeSponsorTier("")).toBe("bronze");
  expect(normalizeSponsorTier("premium")).toBe("bronze");
});

test("Gruppen in Stufenreihenfolge, leere Stufen fehlen", () => {
  const groups = groupSponsorsByTier([
    { id: "1", tier: "bronze" },
    { id: "2", tier: "main" },
    { id: "3", tier: "gold" },
    { id: "4", tier: null },
  ]);
  expect(groups.map((group) => group.tier.key)).toEqual(["main", "gold", "bronze"]);
  expect(groups[2].items.map((item) => item.id)).toEqual(["1", "4"]);
  expect(groups[0].tier.perRow).toBe(1);
});
