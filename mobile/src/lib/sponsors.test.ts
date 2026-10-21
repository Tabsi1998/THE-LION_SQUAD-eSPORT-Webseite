import { groupSponsorsByTier, logoToneMode, normalizeSponsorTier } from "./sponsors";

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

describe("logoToneMode (#1916)", () => {
  test("weiße Fassung vor Einfärben, Logo mit Kasten auf der Fläche", () => {
    expect(logoToneMode({ logo_url: "/a.png", logo_mono_url: "/a-weiss.png", logo_transparent: false })).toBe("file");
    expect(logoToneMode({ logo_url: "/a.png", logo_transparent: true })).toBe("tint");
    expect(logoToneMode({ logo_url: "/a.jpg", logo_transparent: false })).toBe("surface");
    expect(logoToneMode({ logo_url: "/a.png" })).toBe("surface");
    expect(logoToneMode(null)).toBe("surface");
  });
});
