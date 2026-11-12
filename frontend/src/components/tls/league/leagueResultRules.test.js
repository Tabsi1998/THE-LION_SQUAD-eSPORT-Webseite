import { mapRuleProblem, ruleHint } from "./leagueResultRules";
import { gamesProblem, staffProblem } from "./leagueGames";

// Ergebnisregeln je Map (docs/LIGA.md, C.3, #1617): dieselben Sätze wie der Server (services/league_result_rules.py), damit
// niemand erst nach dem Absenden erfährt, dass 7:5 bei höchstens 11 Runden nicht geht. Erfundene Werte.

const SIDES = [{ registration_id: "a", name: "Rudel A" }, { registration_id: "h", name: "Horst" }];
const SCORE = { kind: "score", target: 250, time_limit_minutes: 10 };
const ROUNDS = { kind: "rounds", target: 6, round_limit: 11 };
const LEAGUE = { sides: SIDES, result_rules: { stellung: SCORE, suchen: ROUNDS }, scores_required: false };

const game = (mode, winner, own, other, extra = {}) => ({
  position: 1, mode, map_id: "m", winner, scores: { [winner]: own, [winner === "a" ? "h" : "a"]: other }, ...extra,
});

test.each([
  ["score ok", "stellung", 250, 180, null],
  ["score Sieger mit weniger", "stellung", 100, 250, "Map 1: Der Endstand 100:250 passt nicht zum Sieger – mehr Punkte hat Horst."],
  ["score über dem Ziel", "stellung", 251, 240, "Map 1: höchstens 250 Punkte – die Map endet beim Ziel (Endstand 251:240)."],
  ["rounds 6:5", "suchen", 6, 5, null],
  ["rounds 7:5", "suchen", 7, 5, "Map 1: höchstens 11 Runden – 7:5 sind 12."],
  ["rounds 7:4", "suchen", 7, 4, "Map 1: höchstens 6 Rundensiege – die Map endet beim Ziel (Endstand 7:4)."],
  ["rounds 5:4", "suchen", 5, 4, "Map 1: Die Map endet erst bei 6 gewonnenen Runden – der Sieger hat 5."],
  ["rounds Gleichstand", "suchen", 6, 6, "Map 1: Gleichstand (6:6) gibt es in diesem Modus nicht – bitte Endstand und Sieger prüfen."],
  ["rounds Kommazahl", "suchen", "5,5", 4, "Map 1: Punkte bitte als ganze Zahl angeben."],
  ["ohne Regel", "frei", 100, 250, null],
])("%s", (_name, mode, own, other, expected) => {
  expect(mapRuleProblem(game(mode, "a", own, other), LEAGUE)).toBe(expected);
});

test("ohne Punkte keine Prüfung - mit Pflicht der Satz der Liga, halbe Punkte nie", () => {
  const empty = { position: 2, mode: "stellung", winner: "a", scores: {} };
  expect(mapRuleProblem(empty, LEAGUE)).toBeNull();
  expect(mapRuleProblem(empty, { ...LEAGUE, scores_required: true }))
    .toBe("Map 2: bitte die Punkte beider Seiten eintragen – in dieser Liga sind sie Pflicht.");
  expect(mapRuleProblem({ ...empty, scores: { a: "250", h: "" } }, LEAGUE)).toBe("Map 2: bitte die Punkte beider Seiten eintragen.");
  // Eine zugesprochene Map hat keine Punkte und keine Regel.
  expect(mapRuleProblem({ ...empty, decision: "awarded" }, { ...LEAGUE, scores_required: true })).toBeNull();
});

test("die Regel als kurzer Hinweis je Map", () => {
  expect(ruleHint(SCORE)).toBe("bis 250 Punkte · 10 Min.");
  expect(ruleHint({ kind: "score", target: 250 })).toBe("bis 250 Punkte");
  expect(ruleHint(ROUNDS)).toBe("6 Runden, höchstens 11");
  expect(ruleHint({ kind: "rounds", target: 1 })).toBe("1 Runde");
  expect(ruleHint({ kind: "rounds", target: 13, round_limit: 24, overtime: true, draw_allowed: true })).toBe("13 Runden, höchstens 24 · Verlängerung · Remis möglich");
  expect(ruleHint({ kind: "highest" })).toBe("höherer Endstand gewinnt");
  expect(ruleHint(null)).toBe("");
});

const FORM = {
  best_of: 1, needed: 1, team_size: 1, mode_order: [], sides: SIDES, result_rules: { suchen: ROUNDS },
  pool: { modes: [{ mode: "suchen", label: "Suchen", maps: [{ map_id: "turm", name: "Turm" }] }] },
};

test("das Formular und das Ergebnis-Fenster prüfen die Regel vorab, der Superadmin kann sie übergehen", () => {
  const games = [{ position: 1, mode: "suchen", map_id: "turm", winner: "a", scores: { a: "7", h: "5" }, lineup: ["u1"] }];
  expect(gamesProblem(games, FORM)).toBe("Map 1: höchstens 11 Runden – 7:5 sind 12.");
  expect(staffProblem(games, FORM)).toBe("Map 1: höchstens 11 Runden – 7:5 sind 12.");
  expect(staffProblem(games, FORM, {}, { skipRules: true })).toBeNull();
  expect(gamesProblem([{ ...games[0], scores: { a: "6", h: "5" } }], FORM)).toBeNull();
});
