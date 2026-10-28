import { formatTournamentDisplay, formatTournamentFormat } from "./tournamentLabels";

// Formatnamen (#2111, F1): das Turnierformat „Liga“ heißt „Jeder gegen jeden – Hin- und Rückrunde“ - die Vereinsliga
// mit Seasons und Staffeln ist Admin → Liga. Eine Staffel heißt weiter „Liga“, ein eigener Anzeigename gewinnt.
test("Jeder gegen jeden: einfach und mit Hin- und Rückrunde, die Staffel bleibt „Liga“", () => {
  expect(formatTournamentFormat("round_robin")).toBe("Jeder gegen jeden – einfach");
  expect(formatTournamentFormat("league")).toBe("Jeder gegen jeden – Hin- und Rückrunde");
  expect(formatTournamentDisplay({ format: "league" })).toBe("Jeder gegen jeden – Hin- und Rückrunde");
  expect(formatTournamentDisplay({ format: "league", league_context: { staffel: "A" } })).toBe("Liga");
  expect(formatTournamentDisplay({ format: "league", format_label: "Winterliga" })).toBe("Winterliga");
});
