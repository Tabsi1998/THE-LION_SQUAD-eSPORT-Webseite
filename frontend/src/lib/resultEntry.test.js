// Ergebnis-Fenster (#1156, #1370): was die Eingabe dem Server schickt und welcher Satz davor steht. Dieselben Fälle
// prüft die App (mobile/src/lib/resultEntry.test.ts) - beide lesen resultEntry.cases.json.
import cases from "./resultEntry.cases.json";
import {
  bestOfResults,
  initialState,
  inputKind,
  orderResults,
  pointsResults,
  resultSentence,
  resultsFor,
  scoreResults,
  tapGame,
  winnerResults,
  winsNeeded,
} from "./resultEntry";

const outcome = (result, { results, error }) => expect(result).toEqual(error ? { error } : { results });

test.each(cases.kind)("Eingabe: $name", ({ entry, heatMode, kind }) => expect(inputKind(entry, heatMode)).toBe(kind));
test.each(cases.score)("1 gegen 1: $name", ({ input, ...want }) => outcome(scoreResults(input), want));
test.each(cases.bestof)("Best-of: $name", ({ input, ...want }) => outcome(bestOfResults(input), want));
test.each(cases.winner)("Zeitduell: $name", ({ input, ...want }) => outcome(winnerResults(input), want));
test.each(cases.order)("Reihenfolge: $name", ({ input, ...want }) => outcome(orderResults(input), want));
test.each(cases.points)("Punkte: $name", ({ input, ...want }) => outcome(pointsResults(input), want));
test.each(cases.tap)("Best-of antippen: $name", ({ input, games }) => {
  expect(tapGame(input.games, input.index, input.winner, { sides: input.sides, bestOf: input.bestOf })).toEqual(games);
});
test.each(cases.sentence)("Satz: $name", ({ entry, results, sentence }) => expect(resultSentence(entry, results)).toBe(sentence));

test("die Eingabe passt zum Format", () => {
  expect(inputKind({ kind: "duel", best_of: 1 })).toBe("score");
  expect(inputKind({ kind: "duel", best_of: 3 })).toBe("bestof");
  expect(inputKind({ kind: "duel", ranking_mode: "time" })).toBe("winner");
  expect(inputKind({ kind: "heat" })).toBe("order");
  expect(inputKind({ kind: "heat" }, "points")).toBe("points");
  expect(inputKind({ kind: "heat", ranking_mode: "time" }, "points")).toBe("order");
  expect(winsNeeded(5)).toBe(3);
});

test("ein gespeichertes Ergebnis wird zum Anfangszustand fürs Korrigieren", () => {
  const entry = {
    kind: "duel", best_of: 1, ranking_mode: "higher_score",
    participants: [{ registration_id: "a", name: "NeonFalke" }, { registration_id: "b", name: "PixelPanther" }],
    result: [{ registration_id: "a", rank: 1, score: 3 }, { registration_id: "b", rank: 2, score: 1 }],
  };
  const state = initialState(entry);
  expect(state.scores).toEqual({ a: 3, b: 1 });
  expect(resultsFor(entry, "score", state)).toEqual({ results: [{ registration_id: "a", rank: 1, score: 3 }, { registration_id: "b", rank: 2, score: 1 }] });
});
