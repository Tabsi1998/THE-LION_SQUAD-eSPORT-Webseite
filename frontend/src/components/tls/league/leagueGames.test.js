import { changeGame, followLineups, confirmPayload, gamesProblem, mapsFor, modeFor, reportPayload, seriesSentence, settleGames, startGames, toggleLineup } from "./leagueGames";

// Ergebnis je Map (#1650): wie das Formular rechnet - Serie, nächste Map, Sätze und was an den Server geht.

const LEAGUE = {
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
  expect(gamesProblem([{ ...open[0], map_id: "hafen", winner: "a", lineup: ["u1", "u2"], scores: { a: "x" } }], LEAGUE)).toBe("Map 1: Punkte bitte als Zahl ab 0.");
});

test("Meldung und Bestätigung für den Server", () => {
  const games = [
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
  const games = changeGame([{ position: 1, lineup: [] }, { position: 2, lineup: [] }], 1, { position: 1, lineup: ["u1"], winner: "a" });
  expect(games).toEqual([{ position: 1, lineup: ["u1"], winner: "a" }, { position: 2, lineup: ["u1"] }]);
});