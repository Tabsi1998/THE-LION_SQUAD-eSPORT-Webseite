import { attemptsText, entryKey } from "./fastLapAttempts";

// Versuche in der App (#1585): dieselbe eingestellte Zahl wie Website und TV - nichts ist fest auf 3.
test("zeigt „2 von 3 Versuchen“, ohne Grenze nur die Zahl", () => {
  expect(attemptsText(2, 3)).toBe("2 von 3 Versuchen");
  expect(attemptsText(1, 10)).toBe("1 von 10 Versuchen");
  expect(attemptsText(1, null)).toBe("1 Versuch");
  expect(attemptsText(4, undefined)).toBe("4 Versuche");
  expect(attemptsText(undefined, 3)).toBe("0 von 3 Versuchen");
});

test("Gäste ohne Konto haben ihren eigenen Schlüssel", () => {
  expect(entryKey({ participant_id: "guest-g1", user_id: null })).toBe("guest-g1");
  expect(entryKey({ user_id: "u1" })).toBe("u1");
});
