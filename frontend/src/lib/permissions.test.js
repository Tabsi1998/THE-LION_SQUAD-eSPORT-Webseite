import { adminHome, adminWithoutSecondFactor, areaList, areasOf, canUseArea, hasArea, isAnyAdmin, leadWithoutSecondFactor, mfaSetupPath, roleLabel, showsDutyEntry } from "./permissions";

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

// Derselbe Vertrag wie `require_area` im Server (#1479): enthält die Liste einen Bereich mit Zwei-Faktor, braucht es
// die Bestätigung - auch wenn die Person aus der Liste nur Moderation hat.
test("canUseArea wie require_area: Moderation in der Liste öffnet keinen Bereich mit Zwei-Faktor", () => {
  const admin = { role: "club_admin", mfa_enabled: true, auth_mfa_verified: true };
  const adminWithout = { ...admin, auth_mfa_verified: false };
  const moderator = { role: "moderator" };
  expect(canUseArea(adminWithout, "finance", "moderation")).toBe(false);
  expect(canUseArea(adminWithout, ["moderation", "finance"])).toBe(false);
  expect(canUseArea(moderator, "tournaments", "moderation")).toBe(false);
  expect(canUseArea(adminWithout, "moderation")).toBe(true);
  expect(canUseArea(moderator, "moderation")).toBe(true);
  expect(canUseArea(admin, "finance", "moderation")).toBe(true);
  expect(canUseArea({ role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true }, "finance", "content")).toBe(true);
  expect(canUseArea({ role: "player" }, "moderation")).toBe(false);
  expect(canUseArea(null, "moderation")).toBe(false);
});

// Wohin /admin führt (#1352, #1353): Verwaltung mit Zwei-Faktor auf die Startseite (auch der Kassier, #992), Helfer auf
// „Mein Dienst“, nur Moderation zu den Meldungen, wer keinen Dienst hat auf „Kein Zugriff“ mit dem freundlichen Satz.
test.each([
  ["Superadmin mit 2FA", { role: "superadmin", mfa_enabled: true, auth_mfa_verified: true }, "dashboard", false],
  ["Kassier (nur Finanzen) mit 2FA", { role: "player", areas: ["finance"], mfa_enabled: true, auth_mfa_verified: true }, "dashboard", false],
  ["Redaktion ohne 2FA", { role: "player", areas: ["content"] }, "mfa", false],
  ["Turnierleitung ohne 2FA, mit Einsatz", { role: "tournament_admin", has_staff_assignment: true }, "duty", true],
  ["Turnierleitung mit 2FA und Einsatz", { role: "tournament_admin", has_staff_assignment: true, mfa_enabled: true, auth_mfa_verified: true }, "dashboard", false],
  ["Helfer (Spieler mit Einsatz)", { role: "player", has_staff_assignment: true, is_tournament_staff: true }, "duty", true],
  ["Moderator", { role: "moderator" }, "moderation", true],
  ["Moderator mit Einsatz", { role: "moderator", has_staff_assignment: true }, "duty", true],
  ["Captain einer Serie (#1749)", { role: "player", has_series_captain: true }, "duty", true],
  ["Redaktion mit 2FA, auch Captain", { role: "player", areas: ["content"], has_series_captain: true, mfa_enabled: true, auth_mfa_verified: true }, "dashboard", false],
  ["Spieler ohne Dienst", { role: "player" }, "none", false],
  ["nicht angemeldet", null, "login", false],
])("%s → %s", (_name, user, target, dutyEntry) => {
  expect(adminHome(user)).toBe(target);
  expect(showsDutyEntry(user)).toBe(dutyEntry);
});
