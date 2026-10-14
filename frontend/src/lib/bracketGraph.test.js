import { describe, expect, it } from "vitest";
import { clone, decide, doubleElimination, find, singleElimination } from "../../e2e/fixtures/tvBrackets.mjs";
// FFA-Bäume aus dem echten Generator und dem echten Umbau (scripts/make_ffa_bracket_fixture.py) - keine Handarbeit.
import FFA from "../../e2e/fixtures/ffaGenerated.json";
import { readFileSync } from "node:fs";
import path from "node:path";
import { FINAL_SECTIONS, LOSER_SECTIONS, advancementModeOf, bracketEdges, diffBracket, drawRails, heatExits, matchFate, orderEdges, pathFor, railKey, sectionGroup, slotDrawn, slotOpen, soloAdvance } from "./bracketGraph";

// Turnierbaum neu (#1561): die Linien kommen aus den echten Quellen der Plätze („W:A:1“, `advancement`), nicht aus der
// Reihenfolge der Spiele. Dazu: was mit einem Spiel geschah (entfällt, zusammengelegt), dein Weg und die Bewegungen,
// die ein neuer Stand auslöst.

const pairs = (edges) => edges.map((edge) => `${edge.from}>${edge.to}:${edge.toSlot}`).sort();
const ffa = (state) => structuredClone(FFA[state]);
const keyOf = (bracket) => { const keys = new Map(bracket.matches_v2.map((match) => [match.id, match.match_key])); return (id) => keys.get(id); };
const keyPairs = (bracket, edges) => { const key = keyOf(bracket); return edges.map((edge) => `${key(edge.from)}>${key(edge.to)}:${edge.toSlot}`).sort(); };

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

  it("FFA-Läufe (echter Generator, 16 Fahrer): 4 Läufe → 2 Läufe → Finale, je Weiterkommer eine Linie in seinen Platz", () => {
    const bracket = ffa("ffa16");
    expect(FFA.plan16).toEqual([[[4, 2], [4, 2], [4, 2], [4, 2]], [[4, 2], [4, 2]], [[4, 0]]]);
    expect(keyPairs(bracket, bracketEdges(bracket.matches_v2))).toEqual([
      "A>E:1", "A>E:3", "B>F:1", "B>F:3", "C>F:2", "C>F:4", "D>E:2", "D>E:4", "E>G:1", "E>G:3", "F>G:2", "F>G:4",
    ]);
  });

  it("nimmt `advancement`, wenn ein Platz seine Herkunft nicht kennt", () => {
    const matches = [
      { id: "a", match_key: "A", section: "WB", round: 1, slots: [{ slot: 1 }, { slot: 2 }], advancement: [{ flow: "W", rank: 1, to_match_id: "b", to_slot: 2 }] },
      { id: "b", match_key: "B", section: "WB", round: 2, slots: [{ slot: 1 }, { slot: 2 }] },
    ];
    expect(pairs(bracketEdges(matches))).toEqual(["a>b:2"]);
  });

  it("nach dem Zusammenlegen (echter Umbau, 8 von 16): entfallene Läufe haben keine Linien mehr, A und B führen ins Finale E", () => {
    const bracket = ffa("ffa8_after_merge");
    const edges = bracketEdges(bracket.matches_v2);
    expect(keyPairs(bracket, edges)).toEqual(["A>E:1", "A>E:3", "B>E:2", "B>E:4"]);
    expect(edges.some((edge) => edge.void)).toBe(false);
  });

  it("eine Linie in ein entfallenes Spiel ist ruhig („void“)", () => {
    const bracket = ffa("ffa16");
    find(bracket, "G").status = "cancelled";
    const key = keyOf(bracket);
    const edges = bracketEdges(bracket.matches_v2).filter((edge) => key(edge.to) === "G");
    expect(edges.length).toBe(4);
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
    const single = ffa("ffa16");
    const edges = bracketEdges(single.matches_v2);
    expect(heatExits(find(single, "A"), edges, single.matches_v2)).toEqual({ advance: ["E"], drop: [], qualifiers: 2 });
    // Läufe mit Loser Bracket gibt es nur als eigenes Schema der Turnierleitung (der Server liest es wie dieses).
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

  it("Auslosung (echter Generator, 16 Fahrer): Namen kommen in die Setzplätze - nacheinander", () => {
    const after = ffa("ffa16");
    const before = structuredClone(after);
    for (const match of before.matches_v2) for (const slot of match.slots) if (slot.source?.type === "seed") slot.registration_id = null;
    const events = diffBracket(before.matches_v2, after.matches_v2);
    expect(events.every((event) => event.type === "draw")).toBe(true);
    expect(events).toHaveLength(16);
    expect(events.map((event) => event.index)).toEqual([...Array(16).keys()]);
  });

  it("Läufe zusammengelegt (echter Umbau, 8 von 16): die Namen fließen aus den alten Läufen in die Sammelläufe", () => {
    const before = ffa("ffa8_before_merge");
    const after = ffa("ffa8_after_merge");
    const key = keyOf(after);
    const events = diffBracket(before.matches_v2, after.matches_v2);
    expect(events.filter((event) => event.type === "fate").map((event) => `${key(event.matchId)}:${event.fate}`).sort())
      .toEqual(["C:merged", "D:merged", "F:merged", "G:skipped"]);
    const merges = events.filter((event) => event.type === "merge").map((event) => `${key(event.from.matchId)}>${key(event.matchId)}`).sort();
    expect(merges).toEqual(["C>B", "C>B", "D>A", "D>A"]);
    const playersOf = (bracket, matchKey) => find(bracket, matchKey).slots.map((slot) => slot.registration_id).filter(Boolean);
    expect(events.filter((event) => event.type === "merge" && key(event.matchId) === "A").map((event) => event.registrationId).sort())
      .toEqual(playersOf(before, "D").sort());
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

describe("sectionGroup", () => {
  it("kennt dieselben Namen für das Loser Bracket wie der Server (services/round_labels.LOSER_SECTIONS)", () => {
    const source = readFileSync(path.join(process.cwd(), "../backend/services/round_labels.py"), "utf8");
    const set = /^LOSER_SECTIONS = \{([^}]*)\}/m.exec(source)[1];
    const server = [...set.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
    expect([...LOSER_SECTIONS].sort()).toEqual(server);
    for (const name of server) expect(sectionGroup(name.toUpperCase()), name).toBe("loser");
    expect(sectionGroup("lower_bracket")).toBe("loser");
    expect(sectionGroup("Loser Bracket")).toBe("loser");
    expect(sectionGroup("WB")).toBe("main");
  });

  it("kennt dieselben Namen für das Grand Final wie der Server - „[FINAL]“ im Schema ist das Grand Final (#1591)", () => {
    const source = readFileSync(path.join(process.cwd(), "../backend/services/round_labels.py"), "utf8");
    const set = /^FINAL_SECTIONS = \{([^}]*)\}/m.exec(source)[1];
    const server = [...set.matchAll(/"([^"]+)"/g)].map((match) => match[1]).sort();
    expect([...FINAL_SECTIONS].sort()).toEqual(server);
    for (const name of server) expect(sectionGroup(name.toUpperCase()), name).toBe("final");
  });
});

// Gegner mischen (#1548, #1580): echte Daten aus dem Generator (scripts/make_ffa_bracket_fixture.py), je vor und nach
// der Auslosung. Gemischte Gruppen hängen an einer Sammelschiene (drawRails); der feste Baum bleibt, wie er ist.
describe("Gemischte Runden: Sammelschiene", () => {
  const rail = (bracket) => {
    const key = keyOf(bracket);
    return drawRails(bracket.matches_v2).map(({ key: _key, stageId: _stage, ...entry }) => ({ ...entry, sources: entry.sources.map((source) => `${key(source.id)} ${source.flow}`).sort(), targets: entry.targets.map(key).sort() }));
  };

  it("die Schiene: alle Quellen mit Fluss, die Ziele, Klartext, noch nicht gelost", () => {
    expect(rail(ffa("se8_draw_before"))).toEqual([{ group: "WB:2", label: "Runde 1", sources: ["A W", "B W", "C W", "D W"], targets: ["E", "F"], drawn: false, mode: "draw_round", ready: false, assigned: 0, open: 4 }]);
  });

  it("Doppel-K.-o.: je Loser-Runde eine eigene Schiene, Abstiege als Quellen mit Fluss L", () => {
    const rails = rail(ffa("de8_draw_after"));
    expect(rails.map((entry) => `${entry.group} ${entry.drawn ? "gelost" : "offen"}`)).toEqual(["LB:2 gelost", "LB:3 offen", "WB:2 gelost"]);
    expect(rails.find((entry) => entry.group === "LB:3").sources).toEqual(["E L", "F L", "LA W", "LB W"]);
  });

  it("vor der Auslosung: keine Linie in einen Platz, der gelost wird", () => {
    const bracket = ffa("se8_draw_before");
    const key = keyOf(bracket);
    expect(bracketEdges(bracket.matches_v2).map((edge) => `${key(edge.from)}>${key(edge.to)}`).sort()).toEqual(["E>G", "F>G"]);
  });

  it("nach der Auslosung: je besetztem Platz die echte Linie aus dem Spiel, aus dem der Spieler kam", () => {
    for (const state of ["se8_draw_after", "de8_draw_after", "ffa16_draw_after", "se6_draw_after"]) {
      const bracket = ffa(state);
      const byId = new Map(bracket.matches_v2.map((match) => [match.id, match]));
      const edges = bracketEdges(bracket.matches_v2);
      for (const target of bracket.matches_v2.filter((match) => match.settings?.draw_group && match.draw)) {
        for (const slot of target.slots.filter((row) => row.registration_id)) {
          const into = edges.filter((edge) => edge.to === target.id && edge.toSlot === slot.slot);
          expect(into, `${state} ${target.match_key}:${slot.slot}`).toHaveLength(1);
          expect(into[0].rail).toBe(railKey(target.stage_id, target.settings.draw_group));
          expect(byId.get(into[0].from).match_key).toBe(slot.source_result.from_match_key);
        }
      }
    }
  });

  it("dein Weg: vor der Auslosung bis zur Schiene (nur wer weiterkommt), danach die echte Linie", () => {
    const before = ffa("se8_draw_before");
    const a = find(before, "A");
    const winner = a.results.find((row) => row.rank === 1).registration_id;
    const loser = a.results.find((row) => row.rank === 2).registration_id;
    const edgesBefore = bracketEdges(before.matches_v2);
    expect([...(pathFor(winner, before.matches_v2, edgesBefore).rails || [])]).toEqual([`${railKey(a.stage_id, "WB:2")}:${a.id}`]);
    expect(pathFor(loser, before.matches_v2, edgesBefore).rails).toBeUndefined();
    const after = ffa("se8_draw_after");
    const target = after.matches_v2.find((match) => match.slots.some((slot) => slot.source_result?.from_match_key === "C" && slot.registration_id));
    const player = target.slots.find((slot) => slot.source_result?.from_match_key === "C").registration_id;
    const edges = bracketEdges(after.matches_v2);
    const path = pathFor(player, after.matches_v2, edges);
    const real = edges.find((edge) => edge.from === find(after, "C").id && edge.to === target.id);
    expect(real.rail).toBe(railKey(target.stage_id, "WB:2"));
    expect(path.edges.has(real.id)).toBe(true);
    expect(path.rails).toBeUndefined();
  });

  it("die Auslosung ist eine Bewegung „draw“ je Spieler, gestaffelt - wie in der App", () => {
    const before = ffa("se8_draw_before");
    const after = ffa("se8_draw_after");
    const draws = diffBracket(before.matches_v2, after.matches_v2).filter((event) => event.type === "draw");
    expect(draws).toHaveLength(4);
    expect(draws.map((event) => event.index)).toEqual([0, 1, 2, 3]);
  });

  it("Läufe in eine gemischte Gruppe führen in alle Ziele der Gruppe", () => {
    const bracket = ffa("ffa16_draw_before");
    expect(heatExits(find(bracket, "D"), bracketEdges(bracket.matches_v2), bracket.matches_v2)).toEqual({ advance: ["E", "F"], drop: [], qualifiers: 2 });
  });

  it("gemischt und zusammengelegt (8 von 16): entfallene Läufe sind keine Quellen, die Schiene bleibt im Hauptfeld", () => {
    expect(rail(ffa("ffa8_shuffle_merged"))).toEqual([{ group: "WB:2", label: "Runde 1", sources: ["A W", "B W"], targets: ["E", "F"], drawn: false, mode: "draw_round", ready: false, assigned: 0, open: 4 }]);
  });

  it("fester Baum ohne Mischen: keine Schienen", () => {
    const bracket = ffa("ffa16");
    expect(drawRails(bracket.matches_v2)).toEqual([]);
    expect(bracketEdges(bracket.matches_v2).some((edge) => edge.rail)).toBe(false);
  });
});

// Vier Modi (#1590), echte Daten aus dem Generator: sofort zufällig zieht je Platz, die Show-Auslosung wartet mit
// stehendem Topf auf „Jetzt auslosen“.
describe("Vier Modi: Schiene je Platz", () => {
  const brief = (bracket) => drawRails(bracket.matches_v2).map(({ group, mode, drawn, ready, assigned, open }) => ({ group, mode, drawn, ready, assigned, open }));

  it("sofort zufällig: die Schiene zählt gezogene und offene Plätze - gelost ist, sobald der erste Platz steht", () => {
    expect(brief(ffa("se8_instant_0"))).toEqual([{ group: "WB:2", mode: "instant", drawn: false, ready: false, assigned: 0, open: 4 }]);
    expect(brief(ffa("se8_instant_1"))).toEqual([{ group: "WB:2", mode: "instant", drawn: true, ready: false, assigned: 1, open: 3 }]);
    expect(brief(ffa("se8_instant_2"))).toEqual([{ group: "WB:2", mode: "instant", drawn: true, ready: false, assigned: 2, open: 2 }]);
    expect(brief(ffa("se8_instant_4"))).toEqual([{ group: "WB:2", mode: "instant", drawn: true, ready: false, assigned: 4, open: 0 }]);
    expect(brief(ffa("ffa16_instant_1"))).toEqual([{ group: "WB:2", mode: "instant", drawn: true, ready: false, assigned: 2, open: 6 }]);
  });

  it("sofort zufällig: je gezogenem Platz die echte Linie, die offenen Plätze bleiben ohne Linie", () => {
    const bracket = ffa("se8_instant_2");
    const key = keyOf(bracket);
    const rails = bracketEdges(bracket.matches_v2).filter((edge) => edge.rail);
    expect(rails).toHaveLength(2);
    expect(rails.map((edge) => key(edge.from)).sort()).toEqual(["A", "B"]);
    for (const target of bracket.matches_v2.filter((match) => match.settings?.draw_group)) {
      for (const slot of target.slots) {
        expect(slotDrawn(slot)).toBe(Boolean(slot.registration_id));
        expect(slotOpen(slot)).toBe(!slot.registration_id);
      }
    }
    expect(bracketEdges(ffa("se8_instant_0").matches_v2).some((edge) => edge.rail)).toBe(false);
  });

  it("sofort zufällig: jede Zuweisung ist ein eigener Moment - genau eine Bewegung „draw“ je Ergebnis", () => {
    const one = diffBracket(ffa("se8_instant_0").matches_v2, ffa("se8_instant_1").matches_v2);
    expect(one.map((event) => event.type)).toEqual(["result", "draw"]);
    expect(one[1].index).toBe(0);
    const two = diffBracket(ffa("se8_instant_1").matches_v2, ffa("se8_instant_2").matches_v2);
    expect(two.filter((event) => event.type === "draw")).toHaveLength(1);
    const rest = diffBracket(ffa("se8_instant_2").matches_v2, ffa("se8_instant_4").matches_v2);
    expect(rest.filter((event) => event.type === "draw").map((event) => event.index)).toEqual([0, 1]);
    // Der Weg des Gezogenen: die echte Linie über die Schiene, nicht mehr die Schiene selbst.
    const after = ffa("se8_instant_1");
    const landed = after.matches_v2.find((match) => match.settings?.draw_group && match.slots.some((slot) => slot.registration_id));
    const player = landed.slots.find((slot) => slot.registration_id).registration_id;
    const edges = bracketEdges(after.matches_v2);
    const path = pathFor(player, after.matches_v2, edges);
    expect(path.rails).toBeUndefined();
    expect(edges.some((edge) => edge.rail && path.edges.has(edge.id))).toBe(true);
  });

  it("Show-Auslosung: der Topf steht (ready), bis gelost ist - danach wie jede Auslosung", () => {
    expect(brief(ffa("se8_show_ready"))).toEqual([{ group: "WB:2", mode: "draw_show", drawn: false, ready: true, assigned: 0, open: 4 }]);
    expect(brief(ffa("se8_show_drawn"))).toEqual([{ group: "WB:2", mode: "draw_show", drawn: true, ready: false, assigned: 4, open: 0 }]);
    expect(brief(ffa("se8_draw_before"))).toEqual([{ group: "WB:2", mode: "draw_round", drawn: false, ready: false, assigned: 0, open: 4 }]);
    expect(diffBracket(ffa("se8_show_ready").matches_v2, ffa("se8_show_drawn").matches_v2).filter((event) => event.type === "draw")).toHaveLength(4);
  });

  it("alte Bäume ohne Modus: der Schalter zählt als Auslosung nach der Runde", () => {
    expect(advancementModeOf({ settings: { randomize_advancement_rounds: true } })).toBe("draw_round");
    expect(advancementModeOf({ settings: {} })).toBe("fixed");
    expect(advancementModeOf({ settings: { advancement_mode: "instant", randomize_advancement_rounds: true } })).toBe("instant");
  });
});

// Mehrere K.-o.-Phasen (#1561, Codex-Prüfung): gleich benannte Auslosungs-Gruppen („WB:2“) gehören je zu ihrer Phase.
describe("Gemischte Runden in zwei Phasen", () => {
  // Zweite Phase: dieselben Spiele mit eigenen Kennungen, eigener Phase und eigenen Anmeldungen.
  const twoPhases = (state) => {
    const one = ffa(state);
    const tag = (id) => (id ? `${id}#2` : id);
    const copy = structuredClone(one.matches_v2).map((match) => ({
      ...match, id: tag(match.id), stage_id: tag(match.stage_id || "s"),
      advancement: (match.advancement || []).map((entry) => ({ ...entry, to_match_id: tag(entry.to_match_id) })),
      slots: (match.slots || []).map((slot) => ({ ...slot, registration_id: tag(slot.registration_id), source_result: slot.source_result ? { ...slot.source_result, from_match_id: tag(slot.source_result.from_match_id) } : slot.source_result })),
      results: (match.results || []).map((row) => ({ ...row, registration_id: tag(row.registration_id) })),
      winner_id: tag(match.winner_id),
    }));
    return [...one.matches_v2, ...copy];
  };

  it("zwei Phasen mit „WB:2“: zwei getrennte Schienen, jede nur mit Spielen ihrer Phase", () => {
    const matches = twoPhases("se8_draw_before");
    const rails = drawRails(matches);
    expect(rails.map((rail) => rail.group)).toEqual(["WB:2", "WB:2"]);
    expect(new Set(rails.map((rail) => rail.key)).size).toBe(2);
    for (const rail of rails) {
      const stages = new Set([...rail.sources.map((source) => source.id), ...rail.targets].map((id) => matches.find((match) => match.id === id).stage_id));
      expect(stages.size).toBe(1);
      expect(rail.sources).toHaveLength(4);
      expect(rail.targets).toHaveLength(2);
    }
  });

  it("Lauf-Ziele und dein Weg bleiben in der eigenen Phase", () => {
    const matches = twoPhases("se8_draw_before");
    const edges = bracketEdges(matches);
    const a1 = matches.find((match) => match.match_key === "A" && !match.id.endsWith("#2"));
    const e1 = matches.find((match) => match.match_key === "E" && !match.id.endsWith("#2"));
    const rails = drawRails(matches);
    const own = rails.find((rail) => rail.targets.includes(e1.id));
    expect(rails.filter((rail) => rail.sources.some((source) => source.id === a1.id))).toEqual([own]);
    const winner = a1.results.find((row) => row.rank === 1).registration_id;
    expect([...(pathFor(winner, matches, edges).rails || [])]).toEqual([`${own.key}:${a1.id}`]);
  });

  it("nach der Auslosung: Linien tragen die Schiene ihrer Phase", () => {
    const matches = twoPhases("se8_draw_after");
    const rails = drawRails(matches);
    for (const edge of bracketEdges(matches).filter((row) => row.rail)) {
      const rail = rails.find((entry) => entry.key === edge.rail);
      expect(rail, edge.id).toBeDefined();
      expect(rail.targets).toContain(edge.to);
    }
  });
});
