import { describe, expect, it } from "vitest";
import CASES from "./roundLabelCases.json";
import { displayRoundLabels } from "./bracketNames";
import { matchRoundLabel } from "./tournamentLabels";

// Rundennamen aus einer Quelle (#1792): der Server rechnet `round_label` (backend/tests/test_round_label_cases_unit.py
// prüft dieselben Fälle). Der Web-Baum zeigt diesen Namen unverändert - und TV (Momente, Warteschlange, Aufruf-Tafel)
// liest ihn über matchRoundLabel. So heißt „Loser Runde 1“ überall „Loser Runde 1“.
const served = (match) => {
  const { expected, ...rest } = match;
  return { ...rest, round_label: expected };
};

describe("gemeinsame Rundennamen-Fälle", () => {
  for (const testCase of CASES.cases) {
    it(testCase.name, () => {
      const matches = testCase.matches.map(served);
      const tree = displayRoundLabels(matches);
      expect(tree.map((match) => match.round_label)).toEqual(testCase.matches.map((match) => match.expected));
      expect(matches.map(matchRoundLabel)).toEqual(testCase.matches.map((match) => match.expected));
    });
  }
});
