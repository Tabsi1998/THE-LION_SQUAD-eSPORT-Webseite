import { adminWithoutSecondFactor, areaList, areasOf, canUseArea, hasArea, isAnyAdmin, leadWithoutSecondFactor, mfaSetupPath, roleLabel } from "./permissions";

test("Bereiche kommen vom Server, sonst aus der Rolle", () => {
  expect(areasOf({ role: "player", areas: ["content", "unsinn"] })).toEqual(["content"]);
  expect(areasOf({ role: "tournament_admin" })).toEqual(["tournaments", "moderation"]);
  expect(areasOf({ role: "superadmin" })).toHaveLength(6);
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

// Zwei-Faktor (#291, #1028): Spiegel von services/permissions.py - jeder Bereich außer Moderation nur mit bestätigter
// Zwei-Faktor-Anmeldung; Helfer-Einsätze brauchen sie nicht.
test("Bereiche außer Moderation zählen erst mit bestätigter Zwei-Faktor-Anmeldung", () => {
  const confirmed = { role: "tournament_admin", mfa_enabled: true, auth_mfa_verified: true };
  const unconfirmed = { ...confirmed, auth_mfa_verified: false };
  expect(canUseArea(confirmed, "tournaments")).toBe(true);
  expect(canUseArea(unconfirmed, "tournaments")).toBe(false);
  expect(canUseArea(unconfirmed, "moderation")).toBe(true);
  expect(canUseArea({ role: "player", areas: ["content"], mfa_enabled: true, auth_mfa_verified: true }, "tournaments")).toBe(false);

  expect(leadWithoutSecondFactor(unconfirmed)).toBe(true);
  expect(leadWithoutSecondFactor(confirmed)).toBe(false);
  expect(leadWithoutSecondFactor({ role: "player", areas: ["tournaments"], mfa_enabled: false })).toBe(true);
  expect(leadWithoutSecondFactor({ role: "player", areas: [], is_tournament_staff: true, mfa_enabled: false })).toBe(false);

  expect(adminWithoutSecondFactor(unconfirmed)).toBe(true);
  expect(adminWithoutSecondFactor({ role: "moderator", mfa_enabled: false })).toBe(false);
  expect(adminWithoutSecondFactor({ role: "player", areas: [], is_tournament_staff: true, mfa_enabled: false })).toBe(false);
  expect(adminWithoutSecondFactor(null)).toBe(false);

  expect(mfaSetupPath("/admin/f1")).toBe("/profile?tab=security&mfa=required&next=%2Fadmin%2Ff1");
  expect(mfaSetupPath()).toBe("/profile?tab=security&mfa=required");
});
