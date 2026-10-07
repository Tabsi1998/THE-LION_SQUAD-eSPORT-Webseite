// Champion-Moment (#1119): der goldene Weg aus den Spielen des Siegers - K.-o., Doppel-K.-o. mit Sieger aus dem Loser
// Bracket, Durchgänge; bei mehreren Phasen zählt nur die letzte; ohne entschiedenes Finale kein Champion.
import { championKey, championOf } from "./tvChampion";
import { decide, doubleElimination, find, heatDoubleElimination, play, singleElimination } from "../../e2e/fixtures/tvBrackets.mjs";

const ids = (bracket, keys) => keys.map((key) => find(bracket, key).id);

test("K.-o.: der Weg des Siegers vom ersten Spiel bis zum Finale, Platz 2 und 3 dazu", () => {
  const bracket = singleElimination(8, { bronze: true });
  play(bracket, ["A", "B", "C", "D", "E", "F", "H"]);
  expect(championOf(bracket.matches_v2, bracket.stages)).toBeNull();
  decide(bracket, "G");
  const champion = championOf(bracket.matches_v2, bracket.stages);
  expect(champion.winnerId).toBe("r1");
  expect(champion.path).toEqual(ids(bracket, ["A", "E", "G"]));
  expect(champion.segments).toEqual([{ from: find(bracket, "A").id, to: find(bracket, "E").id }, { from: find(bracket, "E").id, to: find(bracket, "G").id }]);
  expect(champion.podium).toEqual([{ rank: 1, registrationId: "r1" }, { rank: 2, registrationId: "r2" }, { rank: 3, registrationId: "r3" }]);
  expect(champion.viaLoser).toBe(false);
  expect(championKey(champion)).toBe(`${find(bracket, "G").id}:r1`);
});

test("Doppel-K.-o.: der Sieger kommt über das Loser Bracket zurück - der Weg führt durch beide Blöcke", () => {
  const bracket = doubleElimination(8);
  play(bracket, ["A", "B", "C", "D"]);
  // NeonFalke (r1) verliert in der zweiten Runde und fällt ins Loser Bracket …
  decide(bracket, "E", ["r4", "r1"]);
  play(bracket, ["F", "G", "LA", "LB", "LC", "LD", "LE", "LF"]);
  expect(find(bracket, "GF").slots.map((slot) => slot.registration_id)).toEqual(["r2", "r1"]);
  // … und gewinnt das Grand Final.
  decide(bracket, "GF", ["r1", "r2"]);
  const champion = championOf(bracket.matches_v2, bracket.stages);
  expect(champion.winnerId).toBe("r1");
  expect(champion.path).toEqual(ids(bracket, ["A", "E", "LC", "LE", "LF", "GF"]));
  expect(champion.viaLoser).toBe(true);
  expect(champion.podium.map((entry) => entry.rank)).toEqual([1, 2, 3]);
});

test("Durchgänge: der Weg folgt dem Platz, auf dem der Sieger weiterkam - auch als Dritter über das Loser Bracket", () => {
  const bracket = heatDoubleElimination();
  // LuckyLion (r3) wird in Durchgang B Dritter, gewinnt D und E und dann das Grand Final.
  decide(bracket, "A", ["r1", "r4", "r5", "r8"]);
  decide(bracket, "B", ["r2", "r6", "r3", "r7"]);
  play(bracket, ["C"]);
  decide(bracket, "D", ["r3", "r5", "r8", "r7"]);
  decide(bracket, "E", ["r3", "r5", "r4", "r6"]);
  expect(find(bracket, "GF").slots.map((slot) => slot.registration_id)).toEqual(["r1", "r2", "r3", "r5"]);
  decide(bracket, "GF", ["r3", "r2", "r1", "r5"]);
  const champion = championOf(bracket.matches_v2, bracket.stages);
  expect(champion.winnerId).toBe("r3");
  expect(champion.path).toEqual(ids(bracket, ["B", "D", "E", "GF"]));
  expect(champion.podium.map((entry) => entry.registrationId)).toEqual(["r3", "r2", "r1"]);
});

test("mehrere Phasen: nur die letzte zählt - ein Sieger der Vorrunde ist kein Champion", () => {
  const groups = singleElimination(4);
  play(groups, ["A", "B", "C"]);
  const final = singleElimination(4);
  const stageOne = groups.matches_v2.map((match) => ({ ...match, id: `v-${match.id}`, stage_id: "vorrunde", stage_number: 1 }));
  const stageTwo = final.matches_v2.map((match) => ({ ...match, stage_id: "finale", stage_number: 2 }));
  const stages = [{ id: "vorrunde", number: 1 }, { id: "finale", number: 2 }];
  expect(championOf([...stageOne, ...stageTwo], stages)).toBeNull();
  const decided = { matches_v2: stageTwo };
  play(decided, ["A", "B"]);
  decide(decided, "C", ["r4", "r1"]);
  const champion = championOf([...stageOne, ...decided.matches_v2], stages);
  expect(champion.winnerId).toBe("r4");
  expect(champion.path.every((id) => !id.startsWith("v-"))).toBe(true);
});

test("Liga und Gruppen haben kein Finale - dort gibt es keinen goldenen Weg", () => {
  const league = singleElimination(4);
  for (const match of league.matches_v2) match.section = "round_robin";
  play(league, ["A", "B", "C"]);
  expect(championOf(league.matches_v2, league.stages)).toBeNull();
});
