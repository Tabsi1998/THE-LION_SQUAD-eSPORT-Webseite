import { attemptsText, entryKey, entryRowKeys } from "./fastLapAttempts";

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

test("Zeilen-Schlüssel (#1969): stabil über die Person, eindeutig auch bei doppelten Einträgen und ohne Kennung", () => {
  expect(entryRowKeys([{ user_id: "u1" }, { participant_id: "guest-g1" }])).toEqual(["u1", "guest-g1"]);
  // Rutscht eine neue Zeit nach oben, behalten die anderen ihren Schlüssel.
  expect(entryRowKeys([{ user_id: "neu" }, { user_id: "u1" }, { participant_id: "guest-g1" }]).slice(1)).toEqual(["u1", "guest-g1"]);
  expect(entryRowKeys([{ user_id: "u1" }, { user_id: "u1" }])).toEqual(["u1", "u1~2"]);
  expect(entryRowKeys([{ display_name: "Lena" }, { display_name: "Lena" }, {}])).toEqual(["name:Lena", "name:Lena~2", "name:fahrer"]);
});
