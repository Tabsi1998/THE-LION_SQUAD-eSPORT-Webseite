import { VISIBILITY_GROUPS, applyGroupLevel, fieldLevel, groupLevel, visibilityGroupsFor } from "./visibility";

// Die Sichtbarkeit in Gruppen (#257): eine Schnellwahl setzt alle Felder einer
// Gruppe, andere Gruppen bleiben; unterschiedliche Stufen heissen "gemischt".

const contact = VISIBILITY_GROUPS.find((group) => group.k === "contact");

test("ohne Einstellung ist alles oeffentlich", () => {
  expect(fieldLevel(undefined, "email")).toBe("public");
  expect(groupLevel({}, contact)).toBe("public");
});

test("die Schnellwahl setzt alle Felder der Gruppe und laesst andere Gruppen stehen", () => {
  const next = applyGroupLevel({ steam: "private" }, contact, "members");
  expect(next).toEqual({ steam: "private", email: "members", discord: "members", city: "members", country: "members" });
  expect(groupLevel(next, contact)).toBe("members");
});

test("unterschiedliche Stufen in einer Gruppe heissen gemischt", () => {
  expect(groupLevel({ email: "private" }, contact)).toBe("mixed");
});

test("jedes der 37 Felder steht in genau einer Gruppe", () => {
  const keys = VISIBILITY_GROUPS.flatMap((group) => group.fields.map((field) => field.k));
  expect(new Set(keys).size).toBe(keys.length);
  expect(keys).toHaveLength(37);
});

// Abgehakte Plattformen (#558) fehlen in der Sichtbarkeit; ohne Liste bleibt alles wie es ist.
test("abgehakte Plattformen fallen aus den Gruppen, leere Gruppen verschwinden", () => {
  expect(visibilityGroupsFor([])).toBe(VISIBILITY_GROUPS);
  const groups = visibilityGroupsFor(["twitch", "psn"]);
  const keys = groups.flatMap((group) => group.fields.map((field) => field.k));
  expect(keys).not.toContain("twitch");
  expect(keys).not.toContain("psn");
  expect(keys).toHaveLength(35);
  const socialKeys = VISIBILITY_GROUPS.find((group) => group.k === "social").fields.map((field) => field.k);
  expect(visibilityGroupsFor(socialKeys).some((group) => group.k === "social")).toBe(false);
});
