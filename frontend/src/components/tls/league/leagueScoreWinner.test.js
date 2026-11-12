import { changeGame, gamesProblem, rememberGames, scoresTied, scoreWinner, settleGames, withScores } from "./leagueGames";

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

const BO3 = {
  ...LEAGUE, best_of: 3, needed: 2,
  pool: { id: "pool", modes: [{ mode: "stellung", label: "Stellung", maps: ["m1", "m2", "m3"].map((id) => ({ map_id: id, name: id })) }] },
};

test("Zeichen für Zeichen tippen: ein Zwischenstand entscheidet kurz die Serie, Map 3 kommt mit ihren Angaben zurück", () => {
  let games = [
    { ...GAME, map_id: "m1", scores: { a: "100", b: "50" }, winner: "a" },
    { ...GAME, position: 2, map_id: "m2", scores: { a: "100", b: "150" }, winner: "b" },
    { ...GAME, position: 3, map_id: "m3", scores: { a: "6", b: "2" }, winner: "a", proof_id: "p1" },
  ];
  let memory = {};
  for (const value of ["", "1", "16", "160"]) {
    const changed = changeGame(games, 2, withScores(games[1], { a: "100", b: value }, BO3));
    memory = rememberGames(memory, changed);
    games = settleGames(changed, BO3, memory);
  }
  expect(games.map((game) => `${game.position}:${game.map_id}:${game.winner}`)).toEqual(["1:m1:a", "2:m2:b", "3:m3:a"]);
  expect(games[2]).toMatchObject({ scores: { a: "6", b: "2" }, proof_id: "p1" });
});

test("ohne Gedächtnis wie bisher: nach einer offenen Map kommt nichts, nach einem Sieger eine leere", () => {
  expect(settleGames([{ ...GAME, map_id: "m1" }], BO3)).toHaveLength(1);
  const next = settleGames([{ ...GAME, map_id: "m1", winner: "a" }], BO3);
  expect(next).toHaveLength(2);
  expect(next[1]).toMatchObject({ position: 2, map_id: "", winner: "" });
});

test("ungültige Zahl vor fehlendem Sieger, Gleichstand ohne Remis nennt gleich die Regel", () => {
  const required = { ...LEAGUE, scores_required: true };
  expect(gamesProblem([{ ...GAME, scores: { a: "-5", b: "3" } }], required)).toBe("Map 1: Punkte bitte als Zahl ab 0.");
  const ruled = { ...required, result_rules: { stellung: { kind: "score", target: 250 } } };
  expect(gamesProblem([{ ...GAME, scores: { a: "250", b: "250" } }], ruled)).toContain("Gleichstand (250:250) gibt es in diesem Modus nicht");
  expect(gamesProblem([{ ...GAME, scores: { a: "250", b: "250" } }], ruled, { skipRules: true })).toBe("Map 1: Gleichstand – bitte antippen, wer die Map gewonnen hat.");
  expect(gamesProblem([GAME], required, { skipRules: true })).toBe("Map 1: bitte antippen, wer die Map gewonnen hat.");
});
