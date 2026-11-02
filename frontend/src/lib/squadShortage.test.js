import { departureWarning, shortageAfter, shortageWarning } from "./squadShortage";

// Kader unter Mindestgröße (#2202): Abgänge bleiben möglich - der Dialog sagt vorher, was sie bewirken. Erfundene Namen.

const SQUAD = { id: "s-a", name: "Rudel A", member_ids: ["u1", "u2", "u3"], league_requirement: { min_size: 3, title: "Staffel A" } };

test("ein Kader, der unter die Vorgabe der Staffel fällt, wird erkannt", () => {
  expect(shortageAfter(SQUAD, ["u1", "u2"])).toEqual({ name: "Rudel A", size: 2, min: 3, title: "Staffel A" });
});

test("kein Hinweis, wenn der Kader reicht, nicht kleiner wird oder keine Staffel etwas verlangt", () => {
  expect(shortageAfter(SQUAD, ["u1", "u2", "u4"])).toBeNull();
  expect(shortageAfter({ ...SQUAD, member_ids: ["u1"] }, ["u1", "u2"])).toBeNull();
  expect(shortageAfter({ ...SQUAD, member_ids: ["u1", "u2"] }, ["u1", "u2"])).toBeNull();
  expect(shortageAfter({ id: "s-b", name: "Rudel B", member_ids: ["u1", "u2"] }, ["u1"])).toBeNull();
});

test("der Satz nennt Co-Team, Staffel, Zahlen und dass der Abgang möglich bleibt", () => {
  const text = shortageWarning([shortageAfter(SQUAD, ["u1", "u2"])]);
  expect(text).toBe("Damit fällt „Rudel A“ unter den Mindestkader (Staffel A): noch 2 von mindestens 3 Spielern. Das bleibt möglich, Team und Turnierleitung bekommen eine Warnung.");
  expect(shortageWarning([])).toBe("");
});

test("beim Abgang zählen alle Co-Teams, in denen die Person steht", () => {
  const other = { id: "s-b", name: "Rudel B", member_ids: ["u1", "u9"], league_requirement: { min_size: 2, title: "Staffel B" } };
  const text = departureWarning([SQUAD, other, { id: "s-c", name: "Rudel C", member_ids: ["u9"] }], "u1");
  expect(text).toContain("„Rudel A“");
  expect(text).toContain("„Rudel B“");
  expect(text).not.toContain("Rudel C");
  expect(departureWarning([SQUAD], "u9")).toBe("");
  expect(departureWarning(null, "u1")).toBe("");
});
