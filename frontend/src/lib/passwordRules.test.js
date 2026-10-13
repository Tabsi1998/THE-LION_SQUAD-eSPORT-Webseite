import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_BYTES,
  MIN_PASSWORD_LENGTH,
  PASSWORD_RULE_HINT,
  passwordProblem,
} from "./passwordRules";

// Passwortvertrag (#1033): dieselben Regeln wie backend/services/password_policy.py. Erfundene Testwerte.
describe("passwordProblem", () => {
  it("nutzt dieselben Grenzen wie das Backend", () => {
    expect(MIN_PASSWORD_LENGTH).toBe(10);
    expect(MAX_PASSWORD_BYTES).toBe(72);
    expect(PASSWORD_RULE_HINT).toContain("10 Zeichen");
    expect(PASSWORD_RULE_HINT).toContain("72 Byte");
  });

  it.each([
    "a".repeat(10),
    "a".repeat(72),
    "ä".repeat(36),
    "  mit Leerzeichen  ",
    "Löwenrudel-Grüße",
    "Löwenrudel-Grüße".normalize("NFD"),
    "🦁".repeat(10),
  ])("akzeptiert %j", (value) => {
    expect(passwordProblem(value)).toBeNull();
  });

  it("zählt Zeichen nach der Vereinheitlichung, nicht Bausteine", () => {
    expect(passwordProblem("a\u0308".repeat(9))).toBe("Das Passwort braucht mindestens 10 Zeichen.");
    expect(passwordProblem("a\u0308".repeat(10))).toBeNull();
    expect(passwordProblem("🦁".repeat(9))).toBe("Das Passwort braucht mindestens 10 Zeichen.");
  });

  it("zählt Byte wie das Backend", () => {
    expect(passwordProblem("a".repeat(73))).toMatch(/höchstens 72 Byte/);
    expect(passwordProblem("ä".repeat(37))).toMatch(/höchstens 72 Byte/);
    expect(passwordProblem("🦁".repeat(19))).toMatch(/höchstens 72 Byte/);
    expect(passwordProblem("🦁".repeat(18))).toBeNull();
  });

  it.each([
    ["", "Das Passwort braucht mindestens 10 Zeichen."],
    ["kurz", "Das Passwort braucht mindestens 10 Zeichen."],
    [" ".repeat(12), "Das Passwort darf nicht nur aus Leerzeichen bestehen."],
    ["zehn\tzeichen", "Das Passwort darf keine Steuerzeichen wie Tabulator oder Zeilenumbruch enthalten."],
  ])("lehnt %j ab", (value, message) => {
    expect(passwordProblem(value)).toBe(message);
  });

  // Gleiche Fälle wie BLANK_CASES in backend/tests/test_password_contract_unit.py.
  it.each([
    [" ".repeat(12), true],
    ["\u00a0".repeat(10), true],
    ["\u3000".repeat(10), true],
    ["\u2028".repeat(10), true],
    ["\ufeff".repeat(10), false],
    ["\u200b".repeat(10), false],
  ])("prüft „nur Leerzeichen“ mit derselben Zeichenklasse wie der Server: %j", (value, blank) => {
    expect(passwordProblem(value) === "Das Passwort darf nicht nur aus Leerzeichen bestehen.").toBe(blank);
    if (!blank) expect(passwordProblem(value)).toBeNull();
  });
});
