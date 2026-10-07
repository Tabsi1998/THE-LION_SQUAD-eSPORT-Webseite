// Weiter über den Strich (#1117): Zuordnung „von Platz zu Platz“ aus der Herkunft - Duelle, Durchgänge mit 4 Spielern und
// 2 Weiterkommern, Doppel-K.-o., Spiel um Platz 3, Finale; Fahrplan höchstens 4 Sekunden; der Weg endet im Ziel-Platz.
import { advancementsOf, isLoserTarget, outcomeLabel, planTravel, pointOnRoute, routeLength, routePath, travelRoute, travelTotal, TRAVEL } from "./tvTravel";
import { decide, doubleElimination, find, heatDoubleElimination, heats, singleElimination } from "../../e2e/fixtures/tvBrackets.mjs";

const target = (key, slot) => expect.objectContaining({ matchKey: key, slot });

test("K.-o.: der Sieger fährt in seinen Platz im nächsten Spiel, der Verlierer ist raus", () => {
  const bracket = singleElimination(8);
  decide(bracket, "A");
  decide(bracket, "B", ["r5", "r4"]);
  const a = advancementsOf(find(bracket, "A"), bracket.matches_v2);
  expect(a).toEqual([
    expect.objectContaining({ registrationId: "r1", rank: 1, kind: "win", target: target("E", 1) }),
    expect.objectContaining({ registrationId: "r8", rank: 2, kind: "out", target: null }),
  ]);
  const b = advancementsOf(find(bracket, "B"), bracket.matches_v2);
  expect(b[0]).toEqual(expect.objectContaining({ registrationId: "r5", kind: "win", target: target("E", 2) }));
  expect(b.map(outcomeLabel)).toEqual(["weiter", "raus"]);
  // Die Fahrt endet dort, wo der Server den Spieler hingesetzt hat.
  expect(find(bracket, "E").slots.map((slot) => slot.registration_id)).toEqual(["r1", "r5"]);
});

test("Durchgang mit 4 Spielern, 2 kommen weiter: Platz 1 und 2 weiter, Platz 3 und 4 ins Loser Bracket - jeder in seinen Platz", () => {
  const bracket = heatDoubleElimination();
  decide(bracket, "A", ["r4", "r1", "r8", "r5"]);
  const moves = advancementsOf(find(bracket, "A"), bracket.matches_v2);
  expect(moves).toEqual([
    expect.objectContaining({ registrationId: "r4", rank: 1, kind: "win", target: target("C", 1) }),
    expect.objectContaining({ registrationId: "r1", rank: 2, kind: "win", target: target("C", 2) }),
    // „L:A:1“ ist der Beste, der nicht weiterkommt - also Platz 3.
    expect.objectContaining({ registrationId: "r8", rank: 3, kind: "drop", target: target("D", 1) }),
    expect.objectContaining({ registrationId: "r5", rank: 4, kind: "drop", target: target("D", 2) }),
  ]);
  expect(moves.map(outcomeLabel)).toEqual(["weiter", "weiter", "→ Loser Bracket", "→ Loser Bracket"]);
  expect(moves.map((move) => isLoserTarget(move.target))).toEqual([false, false, true, true]);
  // Jeder landet genau dort, wo der Server ihn einträgt.
  for (const move of moves) {
    const slot = find(bracket, move.target.matchKey).slots[move.target.slotIndex];
    expect(slot.registration_id).toBe(move.registrationId);
  }
});

test("Doppel-K.-o.: der Verlierer rutscht ins Loser Bracket, aus dem Loser Bracket geht es ins Grand Final", () => {
  const bracket = doubleElimination(8);
  decide(bracket, "A");
  const moves = advancementsOf(find(bracket, "A"), bracket.matches_v2);
  expect(moves[0]).toEqual(expect.objectContaining({ registrationId: "r1", kind: "win", target: target("E", 1) }));
  expect(moves[1]).toEqual(expect.objectContaining({ registrationId: "r8", kind: "drop", target: expect.objectContaining({ matchKey: "LA", slot: 1, section: "LB" }) }));
  expect(outcomeLabel(moves[1])).toBe("→ Loser Bracket");
  for (const key of ["B", "C", "D", "E", "F", "G", "LA", "LB", "LC", "LD", "LE", "LF"]) decide(bracket, key);
  const lbFinal = advancementsOf(find(bracket, "LF"), bracket.matches_v2);
  expect(lbFinal[0]).toEqual(expect.objectContaining({ kind: "win", target: target("GF", 2) }));
  expect(lbFinal[1].kind).toBe("out");
});

test("Spiel um Platz 3 und Finale: Verlierer des Halbfinales fahren ins Spiel um Platz 3, im Finale stehen Endplätze", () => {
  const bracket = singleElimination(8, { bronze: true });
  for (const key of ["A", "B", "C", "D"]) decide(bracket, key);
  decide(bracket, "E");
  const semi = advancementsOf(find(bracket, "E"), bracket.matches_v2);
  expect(semi[1]).toEqual(expect.objectContaining({ kind: "drop", target: expect.objectContaining({ matchKey: "H", bronze: true }) }));
  expect(outcomeLabel(semi[1])).toBe("→ Spiel um Platz 3");
  decide(bracket, "F");
  decide(bracket, "G");
  decide(bracket, "H");
  expect(advancementsOf(find(bracket, "G"), bracket.matches_v2).map(outcomeLabel)).toEqual(["Platz 1", "Platz 2"]);
  expect(advancementsOf(find(bracket, "H"), bracket.matches_v2).map(outcomeLabel)).toEqual(["Platz 3", "Platz 4"]);
});

test("Durchgänge ohne Loser Bracket: weiter oder raus; Liga und Gruppen ohne Beschriftung; ohne Ergebnis nichts", () => {
  const bracket = heats(16);
  expect(advancementsOf(find(bracket, "A"), bracket.matches_v2)).toEqual([]);
  decide(bracket, "A");
  expect(advancementsOf(find(bracket, "A"), bracket.matches_v2).map(outcomeLabel)).toEqual(["weiter", "weiter", "raus", "raus"]);
  expect(advancementsOf(find(bracket, "A"), bracket.matches_v2, { table: true }).map(outcomeLabel)).toEqual(["", "", "", ""]);
  // Eine Vorrunde, deren Weiterkommer in die nächste Phase gehen: weiter, auch ohne Ziel in dieser Phase.
  const group = { ...find(bracket, "A"), id: "solo", match_key: "Z", stage_id: "vorrunde" };
  expect(advancementsOf(group, [group], { lastStage: false }).map((move) => move.kind)).toEqual(["win", "win", "out", "out"]);
});

test("Fahrplan: Weiterkommer zuerst, Ergebnisse kurz versetzt, zusammen höchstens etwa 4 Sekunden", () => {
  const rides = [
    { id: "a1", matchIndex: 0, order: 0, kind: "win", length: 300 },
    { id: "a2", matchIndex: 0, order: 0, kind: "drop", length: 900 },
    { id: "b1", matchIndex: 1, order: 0, kind: "win", length: 300 },
  ];
  const plan = planTravel(rides);
  const byId = Object.fromEntries(plan.map((entry) => [entry.id, entry]));
  expect(byId.a1.delay).toBe(0);
  expect(byId.a2.delay).toBeGreaterThan(byId.a1.delay);
  expect(byId.b1.delay).toBe(TRAVEL.matchStaggerMs);
  expect(travelTotal(plan)).toBeLessThanOrEqual(TRAVEL.maxMs);
  // Viele Ergebnisse auf einmal: alles rückt zusammen, keine Fahrt wird zum Sprung.
  const many = Array.from({ length: 24 }, (_, index) => ({ id: `r${index}`, matchIndex: Math.floor(index / 4), order: index % 2, kind: index % 4 < 2 ? "win" : "drop", length: 1400 }));
  const squeezed = planTravel(many);
  expect(travelTotal(squeezed)).toBeLessThanOrEqual(TRAVEL.maxMs + 1);
  expect(Math.min(...squeezed.map((entry) => entry.duration))).toBeGreaterThanOrEqual(TRAVEL.minRideMs);
  expect(planTravel([])).toEqual([]);
});

test("der Weg folgt der Linie und endet am Ziel-Platz; ins Loser Bracket ein ruhiger Bogen", () => {
  const line = travelRoute({ x: 100, y: 50 }, { x: 300, y: 150 });
  expect(line.kind).toBe("line");
  expect(routeLength(line)).toBeCloseTo(300);
  expect(pointOnRoute(line, 0)).toEqual({ x: 100, y: 50 });
  expect(pointOnRoute(line, 1)).toEqual({ x: 300, y: 150 });
  expect(pointOnRoute(line, 0.5)).toEqual({ x: 200, y: 100 });
  expect(routePath(line)).toBe("M100 50L200 50L200 150L300 150");
  const curve = travelRoute({ x: 100, y: 50 }, { x: 400, y: 600 }, { curved: true });
  expect(curve.kind).toBe("curve");
  const end = pointOnRoute(curve, 1);
  expect(end.x).toBeCloseTo(400);
  expect(end.y).toBeCloseTo(600);
  expect(routePath(curve)).toMatch(/^M100 50C/);
});
