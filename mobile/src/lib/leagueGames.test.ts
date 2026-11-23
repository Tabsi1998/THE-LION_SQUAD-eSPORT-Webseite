// Portiert aus frontend/src/components/tls/league/leagueGames.test.js und leagueScoreWinner.test.js (#2173): Web und App rechnen
// das Liga-Meldeformular gleich. Erfundene Namen.
import { changeGame, confirmPayload, followLineups, gamesProblem, mapsFor, modeFor, plannedFor, rememberGames, reportPayload, scoresTied, scoreWinner,
  seriesSentence, settleGames, startGames, toggleLineup, withScores, type FormGame, type LeagueBlock } from "./leagueGames";

// Ergebnis je Map (#1650): wie das Formular rechnet - Serie, nächste Map, Sätze und was an den Server geht.

const LEAGUE: LeagueBlock = {
  best_of: 3,
  needed: 2,
  team_size: 2,
  mode_order: ["stellung", "suchen"],
  pool: {
    id: "pool",
    modes: [
      { mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen" }, { map_id: "nebel", name: "Nebel" }] },
      { mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] },
    ],
  },
  sides: [{ registration_id: "a", name: "Loewen · Rudel A" }, { registration_id: "b", name: "Falken · Horst" }],
};

test("Modus je Position aus der Reihenfolge, Maps aus dem Pool", () => {
  expect([1, 2, 3].map((position) => modeFor(position, LEAGUE))).toEqual(["stellung", "suchen", "stellung"]);
  expect(mapsFor(LEAGUE.pool, "suchen").map((item) => item.map_id)).toEqual(["turm"]);
  expect(modeFor(1, { ...LEAGUE, mode_order: [] })).toBe("");
});

// #2129: Gilt die Reihenfolge nicht mehr, liefert der Server sie leer - Formular und Prüfung lesen denselben Wert.
test("ohne geltende Reihenfolge kommt der Modus aus dem Pool, jede Map auch als zweite", () => {
  const onlyStellung = { ...LEAGUE, mode_order: [], pool: { id: "neu", modes: [LEAGUE.pool!.modes![0]] } };
  expect([1, 2].map((position) => modeFor(position, onlyStellung))).toEqual(["stellung", "stellung"]);
  expect(mapsFor(onlyStellung.pool, modeFor(2, onlyStellung)).map((item) => item.map_id)).toEqual(["hafen", "nebel"]);
});

test("die nächste Map kommt mit dem Sieger der letzten - bis die Serie entschieden ist", () => {
  let games = startGames(LEAGUE);
  expect(games).toHaveLength(1);
  games = settleGames([{ ...games[0], map_id: "hafen", winner: "a", lineup: ["u1", "u2"] }], LEAGUE);
  expect(games).toHaveLength(2);
  // Die Aufstellung der Map davor ist vorgegeben.
  expect(games[1]).toMatchObject({ position: 2, mode: "suchen", lineup: ["u1", "u2"] });
  games = settleGames([games[0], { ...games[1], map_id: "turm", winner: "a" }], LEAGUE);
  expect(games).toHaveLength(2);
  expect(seriesSentence(games, LEAGUE)).toBe("Loewen · Rudel A gewinnt 2:0");
  expect(gamesProblem(games, LEAGUE)).toBeNull();
});

test("was fehlt, sagt ein Satz", () => {
  const open = startGames(LEAGUE);
  expect(gamesProblem(open, LEAGUE)).toBe("Map 1: bitte die Map wählen.");
  expect(gamesProblem([{ ...open[0], map_id: "hafen" }], LEAGUE)).toBe("Map 1: bitte antippen, wer die Map gewonnen hat.");
  expect(gamesProblem([{ ...open[0], map_id: "hafen", winner: "a", lineup: ["u1"] }], LEAGUE)).toBe("Map 1: bitte genau 2 Spieler aufstellen.");
  expect(gamesProblem([{ ...open[0], map_id: "hafen", winner: "a", lineup: ["u1", "u2"] }], LEAGUE)).toBe("Best of 3: eine Seite braucht 2 gewonnene Maps.");
  expect(gamesProblem([{ ...open[0], map_id: "hafen", winner: "a", lineup: ["u1", "u2"], scores: { a: "x" } }] as any, LEAGUE)).toBe("Map 1: Punkte bitte als Zahl ab 0.");
});

test("Meldung und Bestätigung für den Server", () => {
  const games: FormGame[] = [
    { position: 1, mode: "stellung", map_id: "hafen", winner: "b", scores: { a: "180", b: "250" }, lineup: ["u1", "u2"] },
    { position: 2, mode: "suchen", map_id: "turm", winner: "a", scores: {}, lineup: ["u1", "u2"] },
    { position: 3, mode: "stellung", map_id: "nebel", winner: "b", scores: { a: "" }, lineup: ["u1", "u3"] },
  ];
  const payload = reportPayload(games, LEAGUE);
  expect(payload.results).toEqual([{ registration_id: "b", rank: 1, score: 2 }, { registration_id: "a", rank: 2, score: 1 }]);
  expect(payload.games[0]).toEqual({ position: 1, mode: "stellung", map_id: "hafen", winner_registration_id: "b", scores: { a: 180, b: 250 }, lineup: ["u1", "u2"] });
  expect(payload.games[2]).not.toHaveProperty("scores");

  const confirm = confirmPayload([
    { position: 1, mode: "stellung", map_id: "hafen", winner_registration_id: "a" },
    { position: 2, mode: "suchen", map_id: "turm", winner_registration_id: "a" },
  ], { 1: ["f1", "f2"], 2: ["f2", "f3"] }, LEAGUE);
  expect(confirm.results).toEqual([{ registration_id: "a", rank: 1, score: 2 }, { registration_id: "b", rank: 2, score: 0 }]);
  expect(confirm.games.map((game) => game.lineup)).toEqual([["f1", "f2"], ["f2", "f3"]]);
});

test("Chips: rein, raus, nie mehr als die Teamgröße", () => {
  expect(toggleLineup([], "u1", 2)).toEqual(["u1"]);
  expect(toggleLineup(["u1", "u2"], "u3", 2)).toEqual(["u1", "u2"]);
  expect(toggleLineup(["u1", "u2"], "u1", 2)).toEqual(["u2"]);
});

test("eine Aufstellung zieht in späteren Maps mit, solange sie dort gleich war", () => {
  expect(followLineups({ 1: ["u1"], 2: ["u1"], 3: ["u3"] }, 1, ["u1", "u2"])).toEqual({ 1: ["u1", "u2"], 2: ["u1", "u2"], 3: ["u3"] });
  expect(followLineups({ 1: [], 2: [] }, 2, ["u1"])).toEqual({ 1: [], 2: ["u1"] });
  const games = changeGame([{ position: 1, lineup: [] }, { position: 2, lineup: [] }] as any, 1, { position: 1, lineup: ["u1"], winner: "a" } as any);
  expect(games).toEqual([{ position: 1, lineup: ["u1"], winner: "a" }, { position: 2, lineup: ["u1"] }]);
});
// Veto (#1618, D.3): Modus und Map je Position stehen fest - das Formular übernimmt sie und fragt nur Sieger, Punkte und Aufstellung.
test("mit Spielreihenfolge aus dem Veto kommen Modus und Map je Map fest, nichts geht an den Server dazu", () => {
  const league: LeagueBlock = { ...LEAGUE, planned_games: [
    { position: 1, mode: "stellung", mode_label: "Stellung", map_id: "nebel", map_name: "Nebel", role: "picked", by_registration_id: "a" },
    { position: 2, mode: "suchen", mode_label: "Suchen", map_id: "turm", map_name: "Turm", role: "picked", by_registration_id: "b" },
    { position: 3, mode: "stellung", mode_label: "Stellung", map_id: "hafen", map_name: "Hafen", role: "decider", by_registration_id: null },
  ] };
  expect(plannedFor(2, league)?.map_id).toBe("turm");
  expect(plannedFor(2, LEAGUE)).toBeNull();
  let games = startGames(league);
  expect(games).toEqual([{ position: 1, mode: "stellung", map_id: "nebel", winner: "", scores: {}, lineup: [], planned: true }]);
  expect(gamesProblem(games, league)).toBe("Map 1: bitte antippen, wer die Map gewonnen hat.");
  games = settleGames([{ ...games[0], winner: "a", lineup: ["u1", "u2"] }], league);
  expect(games[1]).toMatchObject({ position: 2, mode: "suchen", map_id: "turm", planned: true, lineup: ["u1", "u2"] });
  games = settleGames([games[0], { ...games[1], winner: "b" }], league);
  expect(games[2]).toMatchObject({ position: 3, mode: "stellung", map_id: "hafen", planned: true });
  const payload = reportPayload(settleGames([games[0], games[1], { ...games[2], winner: "a" }], league), league);
  expect(payload.games.map((game) => [game.position, game.mode, game.map_id])).toEqual([[1, "stellung", "nebel"], [2, "suchen", "turm"], [3, "stellung", "hafen"]]);
  expect(payload.games.every((game) => !("planned" in game))).toBe(true);
});

// ---- Sieger aus den Punkten

// Sieger aus den Punkten (Fabian 09.11.2026): Wer mehr Punkte hat, gewinnt die Map - niemand tippt ein Team an. Erfundene Namen.

const SW: LeagueBlock = {
  best_of: 1, needed: 1, team_size: 1, mode_order: [],
  pool: { id: "pool", modes: [{ mode: "stellung", label: "Stellung", maps: [{ map_id: "hafen", name: "Hafen" }] }] },
  sides: [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }],
};
const GAME: FormGame = { position: 1, mode: "stellung", map_id: "hafen", winner: "", scores: {}, lineup: ["u1"] };

test("mehr Punkte gewinnen, auch mit Komma und Leerzeichen", () => {
  expect(scoreWinner({ scores: { a: "250", b: "180" } }, SW)).toBe("a");
  expect(scoreWinner({ scores: { a: " 4,5 ", b: "6" } }, SW)).toBe("b");
});

test("fehlt eine Seite, steht keine Zahl da oder ist es gleich: kein Sieger", () => {
  expect(scoreWinner({ scores: { a: "250" } }, SW)).toBeNull();
  expect(scoreWinner({ scores: { a: "250", b: "abc" } }, SW)).toBeNull();
  expect(scoreWinner({ scores: { a: "-1", b: "3" } }, SW)).toBeNull();
  expect(scoreWinner({ scores: { a: "6", b: "6" } }, SW)).toBeNull();
  expect(scoresTied({ scores: { a: "6", b: "6" } }, SW)).toBe(true);
  expect(scoresTied({ scores: { a: "6" } }, SW)).toBe(false);
  expect(scoreWinner({ scores: { a: "6", b: "2" } }, { ...SW, sides: [SW.sides![0]] })).toBeNull();
});

test("neue Punkte setzen, drehen und löschen den Sieger - ein angetippter bleibt, solange eine Seite fehlt", () => {
  const won = withScores(GAME, { a: "250", b: "180" }, SW);
  expect(won.winner).toBe("a");
  expect(withScores(won, { a: "100", b: "180" }, SW).winner).toBe("b");
  expect(withScores(won, { a: "180", b: "180" }, SW).winner).toBe("");
  expect(withScores(won, { a: "250", b: "" }, SW).winner).toBe("");
  const picked = { ...GAME, winner: "b" };
  expect(withScores(picked, { a: "3" }, SW).winner).toBe("b");
});

test("was noch fehlt: bei Punktepflicht die Punkte, bei Gleichstand das Antippen", () => {
  expect(gamesProblem([GAME], { ...SW, scores_required: true })).toBe("Map 1: bitte die Punkte beider Seiten eintragen – daraus ergibt sich der Sieger.");
  expect(gamesProblem([{ ...GAME, scores: { a: "6", b: "6" } }], { ...SW, scores_required: true })).toBe("Map 1: Gleichstand – bitte antippen, wer die Map gewonnen hat.");
  expect(gamesProblem([GAME], SW)).toBe("Map 1: bitte antippen, wer die Map gewonnen hat.");
  expect(gamesProblem([withScores(GAME, { a: "250", b: "180" }, SW)], SW)).toBeNull();
});

const BO3: LeagueBlock = {
  ...SW, best_of: 3, needed: 2,
  pool: { id: "pool", modes: [{ mode: "stellung", label: "Stellung", maps: ["m1", "m2", "m3"].map((id) => ({ map_id: id, name: id })) }] },
};

test("Zeichen für Zeichen tippen: ein Zwischenstand entscheidet kurz die Serie, Map 3 kommt mit ihren Angaben zurück", () => {
  let games: FormGame[] = [
    { ...GAME, map_id: "m1", scores: { a: "100", b: "50" }, winner: "a" },
    { ...GAME, position: 2, map_id: "m2", scores: { a: "100", b: "150" }, winner: "b" },
    { ...GAME, position: 3, map_id: "m3", scores: { a: "6", b: "2" }, winner: "a", proof_id: "p1" } as FormGame,
  ];
  let memory: Record<number, FormGame> = {};
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
  const required = { ...SW, scores_required: true };
  expect(gamesProblem([{ ...GAME, scores: { a: "-5", b: "3" } }], required)).toBe("Map 1: Punkte bitte als Zahl ab 0.");
  const ruled = { ...required, result_rules: { stellung: { kind: "score", target: 250 } } };
  expect(gamesProblem([{ ...GAME, scores: { a: "250", b: "250" } }], ruled)).toContain("Gleichstand (250:250) gibt es in diesem Modus nicht");
  expect(gamesProblem([{ ...GAME, scores: { a: "250", b: "250" } }], ruled, { skipRules: true })).toBe("Map 1: Gleichstand – bitte antippen, wer die Map gewonnen hat.");
  expect(gamesProblem([GAME], required, { skipRules: true })).toBe("Map 1: bitte antippen, wer die Map gewonnen hat.");
});
