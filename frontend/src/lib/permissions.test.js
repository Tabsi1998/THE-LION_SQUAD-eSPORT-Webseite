import { areaList, areasOf, hasArea, isAnyAdmin, roleLabel } from "./permissions";

test("Bereiche kommen vom Server, sonst aus der Rolle", () => {
  expect(areasOf({ role: "player", areas: ["content", "unsinn"] })).toEqual(["content"]);
  expect(areasOf({ role: "tournament_admin" })).toEqual(["tournaments", "moderation"]);
  expect(areasOf({ role: "superadmin" })).toHaveLength(5);
  expect(areasOf({ role: "player" })).toEqual([]);
  expect(areasOf(null)).toEqual([]);
});

test("hasArea prüft irgendeinen der genannten Bereiche", () => {
  const writer = { role: "player", areas: ["content"] };
  expect(hasArea(writer, "content")).toBe(true);
  expect(hasArea(writer, "tournaments", "content")).toBe(true);
  expect(hasArea(writer, ["tournaments", "club"])).toBe(false);
  expect(isAnyAdmin(writer)).toBe(true);
  expect(isAnyAdmin({ role: "moderator" })).toBe(false);
  expect(isAnyAdmin({ role: "tournament_admin" })).toBe(true);
});

test("Rollen und Bereiche haben deutsche Namen", () => {
  expect(roleLabel("club_admin")).toBe("Club-Admin");
  expect(roleLabel("unbekannt")).toBe("unbekannt");
  expect(areaList(["content", "club"])).toBe("„Redaktion“ oder „Vereinsverwaltung“");
});
