import { gamesProblem, scoresTied, scoreWinner, withScores } from "./leagueGames";

// Sieger aus den Punkten (Fabian 09.11.2026): Wer mehr Punkte hat, gewinnt die Map - niemand tippt ein Team an. Erfundene Namen.

const LEAGUE = {
  best_of: 1, needed: 1, team_size: 1, mode_order: [],
  pool: { id: "pool", modes: [{ mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen" }] }] },
  sides: [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }],
};
const GAME = { position: 1, mode: "stellung", map_id: "hafen", winner: "", scores: {}, lineup: ["u1"] };

test("mehr Punkte gewinnen, auch mit Komma und Leerzeichen", () => {
  expect(scoreWinner({ scores: { a: "250", b: "180" } }, LEAGUE)).toBe("a");
  expect(scoreWinner({ scores: { a: " 4,5 ", b: "6" } }, LEAGUE)).toBe("b");
});

test("fehlt eine Seite, steht keine Zahl da oder ist es gleich: kein Sieger", () => {
  expect(scoreWinner({ scores: { a: "250" } }, LEAGUE)).toBeNull();
  expect(scoreWinner({ scores: { a: "250", b: "abc" } }, LEAGUE)).toBeNull();
  expect(scoreWinner({ scores: { a: "-1", b: "3" } }, LEAGUE)).toBeNull();
  expect(scoreWinner({ scores: { a: "6", b: "6" } }, LEAGUE)).toBeNull();
  expect(scoresTied({ scores: { a: "6", b: "6" } }, LEAGUE)).toBe(true);
  expect(scoresTied({ scores: { a: "6" } }, LEAGUE)).toBe(false);
  expect(scoreWinner({ scores: { a: "6", b: "2" } }, { ...LEAGUE, sides: [LEAGUE.sides[0]] })).toBeNull();
});

test("neue Punkte setzen, drehen und löschen den Sieger - ein angetippter bleibt, solange eine Seite fehlt", () => {
  const won = withScores(GAME, { a: "250", b: "180" }, LEAGUE);
  expect(won.winner).toBe("a");
  expect(withScores(won, { a: "100", b: "180" }, LEAGUE).winner).toBe("b");
  expect(withScores(won, { a: "180", b: "180" }, LEAGUE).winner).toBe("");
  expect(withScores(won, { a: "250", b: "" }, LEAGUE).winner).toBe("");
  const picked = { ...GAME, winner: "b" };
  expect(withScores(picked, { a: "3" }, LEAGUE).winner).toBe("b");
});

test("was noch fehlt: bei Punktepflicht die Punkte, bei Gleichstand das Antippen", () => {
  expect(gamesProblem([GAME], { ...LEAGUE, scores_required: true })).toBe("Map 1: bitte die Punkte beider Seiten eintragen – daraus ergibt sich der Sieger.");
  expect(gamesProblem([{ ...GAME, scores: { a: "6", b: "6" } }], { ...LEAGUE, scores_required: true })).toBe("Map 1: Gleichstand – bitte antippen, wer die Map gewonnen hat.");
  expect(gamesProblem([GAME], LEAGUE)).toBe("Map 1: bitte antippen, wer die Map gewonnen hat.");
  expect(gamesProblem([withScores(GAME, { a: "250", b: "180" }, LEAGUE)], LEAGUE)).toBeNull();
});
