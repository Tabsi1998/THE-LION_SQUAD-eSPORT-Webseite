import { USERNAME_RULE_HINT, usernameProblem } from "./username";

// Dieselbe Regel wie im Server (backend/services/usernames.py, #2126).
test.each(["abc", "x".repeat(32), "Max_Mustermann", "a.b-c_1", "  rund  "])("%s ist gültig", (name) => {
  expect(usernameProblem(name)).toBeNull();
});

test.each(["ab", "x".repeat(33), "mit leerzeichen", "a/b", "a#b", "Jörg", "a?b"])("%s ist nicht gültig", (name) => {
  expect(usernameProblem(name)).toBe(`Benutzername: ${USERNAME_RULE_HINT}`);
});

test("leer sagt, dass der Name fehlt", () => {
  expect(usernameProblem("   ")).toBe("Bitte gib einen Benutzernamen ein.");
});
