import { isCeremonyKind } from "./NotificationContext";

// Was die Zeremonie feiert, kommt nicht zusätzlich als Banner (E13, #623): Erfolg, Level, Prestige. Eine aberkannte
// Stufe ist keine Feier und bleibt ein Banner.

test("Erfolg, Level und Prestige sind Zeremonie-Arten, eine Aberkennung nicht", () => {
  expect(isCeremonyKind("achievement")).toBe(true);
  expect(isCeremonyKind("level")).toBe(true);
  expect(isCeremonyKind("prestige")).toBe(true);
  expect(isCeremonyKind("achievement_revoked")).toBe(false);
  expect(isCeremonyKind("direct_message")).toBe(false);
  expect(isCeremonyKind(undefined)).toBe(false);
});
