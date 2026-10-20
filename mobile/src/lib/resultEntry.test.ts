import fs from "fs";
import path from "path";
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
  withFlag,
  type ResultEntry,
  type ResultRow,
} from "./resultEntry";

// Ergebnis-Fenster (#1156, #1370): dieselben Fälle wie auf der Website - beide lesen
// frontend/src/lib/resultEntry.cases.json. Ändert jemand die Rechnung auf einer Seite, wird der Test der anderen rot.
type Case = { name: string; input: Record<string, any>; results?: unknown; error?: string; games?: unknown };
type SentenceCase = { name: string; entry: ResultEntry; results: ResultRow[]; sentence: string };
type KindCase = { name: string; entry: ResultEntry; heatMode?: "order" | "points"; kind: string };
const CASES: Record<string, Case[]> & { sentence: SentenceCase[]; kind: KindCase[] } = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../../../frontend/src/lib/resultEntry.cases.json"), "utf8"),
);

const want = ({ results, error }: Case) => (error ? { error } : { results });

test.each(CASES.kind)("Eingabe: $name", ({ entry, heatMode, kind }) => expect(inputKind(entry, heatMode)).toBe(kind));
test.each(CASES.score)("1 gegen 1: $name", (item) => expect(scoreResults(item.input)).toEqual(want(item)));
test.each(CASES.bestof)("Best-of: $name", (item) => expect(bestOfResults(item.input)).toEqual(want(item)));
test.each(CASES.winner)("Zeitduell: $name", (item) => expect(winnerResults(item.input)).toEqual(want(item)));
test.each(CASES.order)("Reihenfolge: $name", (item) => expect(orderResults(item.input)).toEqual(want(item)));
test.each(CASES.points)("Punkte: $name", (item) => expect(pointsResults(item.input)).toEqual(want(item)));
test.each(CASES.tap)("Best-of antippen: $name", ({ input, games }) => {
  expect(tapGame(input.games, input.index, input.winner, { sides: input.sides, bestOf: input.bestOf })).toEqual(games);
});
test.each(CASES.sentence)("Satz: $name", ({ entry, results, sentence }) => expect(resultSentence(entry, results)).toBe(sentence));

test("Lauf (#1840, wie Web #1823): wer als nicht erschienen markiert ist, steht im Fenster schon so da", () => {
  const entry: ResultEntry = {
    id: "h1", kind: "heat", ranking_mode: "higher_score", result: [],
    participants: [{ registration_id: "a" }, { registration_id: "b", no_show: true }, { registration_id: "c" }, { registration_id: "d" }],
  };
  const state = initialState(entry);
  expect(state.flags).toEqual({ b: "no_show" });
  expect(resultsFor(entry, "order", { ...state, order: ["d", "a", "c"] })).toEqual({ results: [
    { registration_id: "d", rank: 1 }, { registration_id: "a", rank: 2 }, { registration_id: "c", rank: 3 },
    { registration_id: "b", rank: 4, forfeit: true },
  ] });
  // Ein gespeichertes Ergebnis geht vor: wer doch gefahren ist, bleibt ohne Markierung.
  const played = { ...entry, result: [{ registration_id: "b", rank: 1 }, { registration_id: "a", rank: 2 }, { registration_id: "c", rank: 3 }, { registration_id: "d", rank: 4 }] };
  expect(initialState(played).flags).toEqual({});
});

test("die Eingabe passt zum Format", () => {
  expect(inputKind({ kind: "duel", best_of: 1 })).toBe("score");
  expect(inputKind({ kind: "duel", best_of: 5 })).toBe("bestof");
  expect(inputKind({ kind: "heat" }, "points")).toBe("points");
});

test("im Duell verschiebt ein Tipp auf der anderen Seite das Wort", () => {
  const state = { sides: ["a", "b"], flags: { a: "no_show" as const }, scores: {}, order: [], winner: "", games: [] };
  expect(withFlag(state, "b", "gave_up", true).flags).toEqual({ b: "gave_up" });
});
