import { describe, expect, it } from "vitest";
import { clone, decide, doubleElimination, find, heats, singleElimination } from "../../e2e/fixtures/tvBrackets.mjs";
import { bracketEdges, diffBracket, heatExits, matchFate, orderEdges, pathFor, soloAdvance } from "./bracketGraph";

// Turnierbaum neu (#1561): die Linien kommen aus den echten Quellen der Plätze („W:A:1“, `advancement`), nicht aus der
// Reihenfolge der Spiele. Dazu: was mit einem Spiel geschah (entfällt, zusammengelegt), dein Weg und die Bewegungen,
// die ein neuer Stand auslöst.

const pairs = (edges) => edges.map((edge) => `${edge.from}>${edge.to}:${edge.toSlot}`).sort();

describe("bracketEdges", () => {
  it("Single Elimination: jede Linie führt dorthin, wo der Sieger wirklich spielt - auch wenn die Reihenfolge nicht passt", () => {
    const bracket = singleElimination(8);
    // Die Halbfinals vertauscht: nach Reihenfolge ginge A in das untere Halbfinale.
    find(bracket, "E").order = 99;
    const edges = bracketEdges(bracket.matches_v2);
    expect(pairs(edges)).toEqual([
      "m-A>m-E:1", "m-B>m-E:2", "m-C>m-F:1", "m-D>m-F:2", "m-E>m-G:1", "m-F>m-G:2",
    ]);
    expect(edges.every((edge) => edge.flow === "W" && edge.rank === 1 && !edge.cross && !edge.void)).toBe(true);
  });

  it("Double Elimination: Linien ins Loser Bracket, ins Grand Final und in den Reset", () => {
    const bracket = doubleElimination(4, { reset: true });
    const edges = bracketEdges(bracket.matches_v2);
    const fromTo = (from, to) => edges.filter((edge) => edge.from === `m-${from}` && edge.to === `m-${to}`);
    // Verlierer aus dem Winner Bracket fallen ins Loser Bracket - eine Linie über die Grenze der Abschnitte.
    expect(fromTo("A", "LA")).toHaveLength(1);
    expect(fromTo("A", "LA")[0]).toMatchObject({ flow: "L", rank: 2, cross: true });
    expect(fromTo("C", "GF")[0]).toMatchObject({ flow: "W", cross: true });
    expect(fromTo("LB", "GF")[0]).toMatchObject({ flow: "W", cross: true });
    // Ins Reset-Spiel führen beide Plätze des Grand Final.
    expect(fromTo("GF", "GFR").map((edge) => edge.rank).sort()).toEqual([1, 2]);
  });

  it("FFA-Läufe: je Weiterkommer eine Linie in seinen Platz im Finale", () => {
    const bracket = heats(8);
    const edges = bracketEdges(bracket.matches_v2);
    expect(pairs(edges)).toEqual(["m-A>m-C:1", "m-A>m-C:2", "m-B>m-C:3", "m-B>m-C:4"]);
  });

  it("nimmt `advancement`, wenn ein Platz seine Herkunft nicht kennt", () => {
    const matches = [
      { id: "a", match_key: "A", section: "WB", round: 1, slots: [{ slot: 1 }, { slot: 2 }], advancement: [{ flow: "W", rank: 1, to_match_id: "b", to_slot: 2 }] },
      { id: "b", match_key: "B", section: "WB", round: 2, slots: [{ slot: 1 }, { slot: 2 }] },
    ];
    expect(pairs(bracketEdges(matches))).toEqual(["a>b:2"]);
  });

  it("Linien aus einem zusammengelegten Lauf sind ruhig („void“)", () => {
    const bracket = heats(16);
    const b = find(bracket, "B");
    Object.assign(b, { status: "cancelled", merged_into_key: "A", merged_into: "m-A", result_meta: { source: "heat_rebuild", merged_into: "m-A" } });
    const edges = bracketEdges(bracket.matches_v2).filter((edge) => edge.from === "m-B");
    expect(edges.length).toBeGreaterThan(0);
    expect(edges.every((edge) => edge.void)).toBe(true);
  });
});

describe("orderEdges (alte Bäume ohne Herkunft)", () => {
  it("verbindet wie früher nach der Reihenfolge - nur wenn kein Platz seine Herkunft kennt", () => {
    const m = (id, round, order) => ({ id, section: "WB", round, order, slots: [{ slot: 1 }, { slot: 2 }] });
    const rounds = [[m("a", 1, 0), m("b", 1, 1), m("c", 1, 2), m("d", 1, 3)], [m("e", 2, 0), m("f", 2, 1)], [m("g", 3, 0)]];
    expect(orderEdges(rounds).map((edge) => `${edge.from}>${edge.to}`)).toEqual(["a>e", "b>e", "c>f", "d>f", "e>g", "f>g"]);
    expect(orderEdges(rounds).every((edge) => edge.toSlot === 0 && edge.flow === "W")).toBe(true);
  });

  it("dein Weg folgt auch diesen Linien", () => {
    const a = { id: "a", round: 1, status: "completed", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] };
    const b = { id: "b", round: 2, status: "running", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r3" }] };
    const edges = orderEdges([[a], [b]]);
    expect(pathFor("r1", [a, b], edges).edges.size).toBe(1);
    expect(pathFor("r2", [a, b], edges).edges.size).toBe(0);
  });
});

describe("matchFate", () => {
  it("nennt, was mit einem Spiel geschah", () => {
    expect(matchFate({ status: "ready" })).toBeNull();
    expect(matchFate({ status: "cancelled", merged_into_key: "E" })).toEqual({ kind: "merged", into: "E", label: "zusammengelegt in E" });
    expect(matchFate({ status: "cancelled", result_meta: { source: "bracket_reset", needed: false } })).toEqual({ kind: "reset", label: "entfällt · nicht nötig" });
    expect(matchFate({ status: "cancelled", result_meta: { source: "heat_rebuild" } })).toEqual({ kind: "skipped", label: "entfällt" });
    expect(matchFate({ status: "cancelled" })).toEqual({ kind: "skipped", label: "entfällt" });
  });

  it("ein Freilos ist eine Zeile: wer weiterkommt, ohne Zeit und Station", () => {
    expect(soloAdvance({ slots: [{ slot: 1, registration_id: "r1", status: "filled" }, { slot: 2, status: "bye", source: { type: "bye" } }] })).toEqual({ slot: { slot: 1, registration_id: "r1", status: "filled" } });
    expect(soloAdvance({ slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }] })).toBeNull();
    // Durchgänge sind nie eine Freilos-Zeile.
    expect(soloAdvance({ match_type: "ffa", slots: [{ slot: 1, registration_id: "r1" }, { slot: 2, status: "bye" }, { slot: 3, status: "bye" }] })).toBeNull();
  });
});

describe("heatExits", () => {
  it("sagt, wohin die Weiterkommer gehen und was mit den anderen geschieht", () => {
    const single = heats(8);
    const edges = bracketEdges(single.matches_v2);
    expect(heatExits(find(single, "A"), edges, single.matches_v2)).toEqual({ advance: ["C"], drop: [], qualifiers: 2 });
    const { heatDoubleElimination } = HEAT_DE;
    const de = heatDoubleElimination();
    const deEdges = bracketEdges(de.matches_v2);
    expect(heatExits(find(de, "A"), deEdges, de.matches_v2)).toEqual({ advance: ["C"], drop: ["D"], qualifiers: 2 });
  });
});

const HEAT_DE = await import("../../e2e/fixtures/tvBrackets.mjs");

describe("pathFor", () => {
  it("dein Weg: deine Spiele und die Linien dazwischen, dazu der nächste Schritt, solange er offen ist", () => {
    const bracket = play8();
    const edges = bracketEdges(bracket.matches_v2);
    const path = pathFor("r1", bracket.matches_v2, edges);
    expect([...path.matches].sort()).toEqual(["m-A", "m-E", "m-G"]);
    expect(path.edges.has(edges.find((edge) => edge.from === "m-A" && edge.to === "m-E").id)).toBe(true);
    expect(path.edges.has(edges.find((edge) => edge.from === "m-E" && edge.to === "m-G").id)).toBe(true);
    // Wer verloren hat, dessen Weg endet - die Linie weiter gehört nicht dazu.
    const loser = pathFor("r8", bracket.matches_v2, edges);
    expect([...loser.matches]).toEqual(["m-A"]);
    expect(loser.edges.size).toBe(0);
  });
});

function play8() {
  const bracket = singleElimination(8);
  decide(bracket, "A");
  return bracket;
}

describe("diffBracket", () => {
  it("der erste Stand bewegt nichts, derselbe Stand auch nicht", () => {
    const bracket = singleElimination(8);
    expect(diffBracket(null, bracket.matches_v2)).toEqual([]);
    expect(diffBracket(bracket.matches_v2, clone(bracket).matches_v2)).toEqual([]);
  });

  it("Ergebnis: Plätze poppen, der Sieger rückt entlang der Linie ins nächste Spiel", () => {
    const before = singleElimination(8);
    const after = decide(clone(before), "A");
    const events = diffBracket(before.matches_v2, after.matches_v2);
    expect(events.map((event) => event.type)).toEqual(["result", "advance"]);
    expect(events[0]).toMatchObject({ matchId: "m-A" });
    expect(events[1]).toMatchObject({ matchId: "m-E", registrationId: "r1", from: { matchId: "m-A", registrationId: "r1" } });
    // Jede Bewegung hat einen eigenen Schlüssel - so läuft sie genau einmal.
    expect(new Set(events.map((event) => event.key)).size).toBe(events.length);
  });

  it("Auslosung: Namen kommen in die Setzplätze - nacheinander", () => {
    const after = heats(8);
    const before = clone(after);
    for (const match of before.matches_v2) for (const slot of match.slots) if (slot.source?.type === "seed") slot.registration_id = null;
    const events = diffBracket(before.matches_v2, after.matches_v2);
    expect(events.every((event) => event.type === "draw")).toBe(true);
    expect(events).toHaveLength(8);
    expect(events.map((event) => event.index)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it("Läufe zusammengelegt: die Namen fließen aus dem alten Lauf in die Sammelkarte", () => {
    const before = heats(16);
    const after = clone(before);
    const a = find(after, "A");
    const b = find(after, "B");
    const moved = b.slots.map((slot) => slot.registration_id);
    a.slots = [...a.slots.slice(0, 2), ...b.slots.slice(0, 2).map((slot, index) => ({ ...slot, slot: 3 + index }))];
    Object.assign(b, { status: "cancelled", merged_into_key: "A", merged_into: "m-A", slots: b.slots.map((slot) => ({ ...slot, registration_id: null, status: "bye", moved_to: "m-A" })) });
    const events = diffBracket(before.matches_v2, after.matches_v2);
    expect(events.find((event) => event.type === "fate")).toMatchObject({ matchId: "m-B", fate: "merged" });
    const merges = events.filter((event) => event.type === "merge");
    expect(merges.map((event) => event.registrationId)).toEqual(moved.slice(0, 2));
    expect(merges[0]).toMatchObject({ matchId: "m-A", from: { matchId: "m-B" } });
  });

  it("kampflos und ausgefallen werden gemeldet", () => {
    const before = singleElimination(4);
    const after = clone(before);
    Object.assign(find(after, "A"), { status: "forfeit", winner_id: "r1", results: [{ registration_id: "r1", rank: 1 }, { registration_id: "r4", rank: 2, forfeit: true }] });
    Object.assign(find(after, "B"), { status: "cancelled" });
    const types = diffBracket(before.matches_v2, after.matches_v2).map((event) => `${event.type}:${event.matchId}`);
    expect(types).toContain("walkover:m-A");
    expect(types).toContain("fate:m-B");
  });
});
