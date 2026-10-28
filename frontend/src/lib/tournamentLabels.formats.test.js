import { formatTournamentDisplay, formatTournamentFormat, tournamentFormatOptions } from "./tournamentLabels";

// Formatnamen (#2111, F1): das Turnierformat „Liga“ heißt „Jeder gegen jeden – Hin- und Rückrunde“ - die Vereinsliga
// mit Seasons und Staffeln ist Admin → Liga. Eine Staffel heißt weiter „Liga“, ein eigener Anzeigename gewinnt.
test("Jeder gegen jeden: einfach und mit Hin- und Rückrunde, die Staffel bleibt „Liga“", () => {
  expect(formatTournamentFormat("round_robin")).toBe("Jeder gegen jeden – einfach");
  expect(formatTournamentFormat("league")).toBe("Jeder gegen jeden – Hin- und Rückrunde");
  expect(formatTournamentDisplay({ format: "league" })).toBe("Jeder gegen jeden – Hin- und Rückrunde");
  expect(formatTournamentDisplay({ format: "league", league_context: { staffel: "A" } })).toBe("Liga");
  expect(formatTournamentDisplay({ format: "league", format_label: "Winterliga" })).toBe("Winterliga");
});

// Überlebensmodus (#2111, TA5): verhält sich wie „Mehrspieler frei“ und heißt auch so - zur Wahl steht er nicht mehr;
// ein bestehendes Turnier sieht „Mehrspieler frei“ genau einmal, als sein eigenes Format.
test("Überlebensmodus heißt „Mehrspieler frei“ und steht nur bei bestehenden Turnieren zur Wahl", () => {
  expect(formatTournamentFormat("battle_royale")).toBe("Mehrspieler frei");
  const values = (current) => tournamentFormatOptions(current).map(([value]) => value);
  expect(values("")).not.toContain("battle_royale");
  expect(values("")).toContain("ffa");
  expect(values("battle_royale")).toContain("battle_royale");
  expect(values("battle_royale")).not.toContain("ffa");
});
// Zeitfahren und Rennserie (#2111, TA6): ohne Generator entstehen nie Spiele - beim Anlegen nicht mehr zur Wahl,
// bestehende Turniere behalten ihr Format.
test("Zeitfahren und Rennserie stehen nur bei bestehenden Turnieren zur Wahl", () => {
  const values = (current) => tournamentFormatOptions(current).map(([value]) => value);
  expect(values("")).not.toContain("time_trial");
  expect(values("")).not.toContain("grand_prix");
  expect(values("time_trial")).toContain("time_trial");
  expect(values("grand_prix")).toEqual(expect.arrayContaining(["grand_prix", "ffa", "league"]));
});