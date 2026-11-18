import { youLabel } from "./youLabel";

test("„Du“ für die eigene Anmeldung, „Dein Team“ für die Anmeldung des eigenen Teams (#1316)", () => {
  expect(youLabel({ id: "r1", user_id: "u1", team_id: null })).toBe("Du");
  expect(youLabel({ id: "r1" })).toBe("Du");
  expect(youLabel(null)).toBe("Du");
  expect(youLabel({ id: "r2", team_id: "tm1" })).toBe("Dein Team");
  expect(youLabel({ id: "r2", team: { id: "tm1", name: "Neon Kings" } })).toBe("Dein Team");
});
