import { flipDeltas, rankMoves } from "./flip";

// FLIP (#1585): wer in der Tabelle den Platz wechselt, gleitet von der alten Stelle an die neue. Gerechnet wird nur
// der Weg - bewegt wird über transform.

test("flipDeltas: der Weg von alt nach neu, nur für Zeilen, die es vorher schon gab und die sich bewegt haben", () => {
  const before = new Map([["a", 0], ["b", 40], ["c", 80]]);
  const after = new Map([["c", 0], ["a", 40], ["b", 80], ["neu", 120]]);
  expect([...flipDeltas(before, after)]).toEqual([["c", 80], ["a", -40], ["b", -40]]);
  expect(flipDeltas(before, before).size).toBe(0);
  expect(flipDeltas(new Map([["a", 0]]), new Map([["a", 0.5]])).size).toBe(0);
  expect(flipDeltas(null, after).size).toBe(0);
});

test("rankMoves: wer aufsteigt, wer absteigt - neue Zeilen zählen nicht", () => {
  const before = [{ participant_id: "a", rank: 1 }, { participant_id: "b", rank: 2 }];
  const after = [{ participant_id: "b", rank: 1 }, { participant_id: "a", rank: 2 }, { user_id: "c", rank: 3 }];
  expect(rankMoves(before, after)).toEqual(new Map([["b", "up"], ["a", "down"]]));
  expect(rankMoves(after, after).size).toBe(0);
  expect(rankMoves(undefined, after).size).toBe(0);
});
