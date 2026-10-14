import { describe, expect, it } from "vitest";
import fixture from "../../e2e/fixtures/matchplanGenerated.json";
import { dependencyGraph, flowLayout, relatedOf } from "./matchFlow";

// „Wer wartet auf wen“ (#1557): die Abhängigkeiten aus dem Graph der Spiele (Weiterleitungen und Platz-Herkunft),
// wie der Planer sie liest. Daten: der Cup aus dem Prototyp, gebaut vom echten Generator.

const matches = fixture.local.applied.matches;
const keyOf = (graph, id) => graph.nodes.find((node) => node.id === id)?.key;

describe("Abhängigkeiten", () => {
  const graph = dependencyGraph(matches);
  const node = (key) => graph.nodes.find((item) => item.key === key);

  it("ein Knoten je Spiel, die Spalte ist die längste Kette davor", () => {
    expect(graph.nodes).toHaveLength(14);
    expect(["A", "B", "C", "D"].map((key) => node(key).depth)).toEqual([0, 0, 0, 0]);
    expect(["E", "F", "LA", "LB"].map((key) => node(key).depth)).toEqual([1, 1, 1, 1]);
    expect(["G", "LC", "LD"].map((key) => node(key).depth)).toEqual([2, 2, 2]);
    expect(node("LE").depth).toBe(3);
    expect(node("LF").depth).toBe(4);
    expect(node("FINAL").depth).toBe(5);
  });

  it("Kanten tragen, wer weiterkommt (W) und wer ins Loser Bracket fällt (L)", () => {
    const fromA = graph.edges.filter((edge) => keyOf(graph, edge.from) === "A").map((edge) => `${edge.kind}:${keyOf(graph, edge.to)}`);
    expect(fromA.sort()).toEqual(["L:LA", "W:E"]);
    expect(graph.edges.filter((edge) => keyOf(graph, edge.to) === "FINAL")).toHaveLength(2);
  });

  it("antippen zeigt, was ein Spiel braucht und was danach darauf wartet", () => {
    const related = relatedOf(graph, node("E").id);
    expect(related.needs.map((id) => keyOf(graph, id)).sort()).toEqual(["A", "B"]);
    expect(related.next.map((id) => keyOf(graph, id)).sort()).toEqual(["G", "LC"]);
  });

  it("gemischte Runde: wartet auf alle Spiele, die in die Gruppe weiterleiten", () => {
    const drawn = matches.map((match) => (["E", "F"].includes(match.match_key) ? { ...match, settings: { ...match.settings, draw_group: "WB:2" } } : match));
    const mixed = dependencyGraph(drawn);
    const e = mixed.nodes.find((item) => item.key === "E");
    expect(relatedOf(mixed, e.id).needs.map((id) => keyOf(mixed, id)).sort()).toEqual(["A", "B", "C", "D"]);
  });

  it("Vorschau-Spiele zählen nicht, solange es echte gibt", () => {
    const withPreview = [...matches, { ...matches[0], id: "vorschau", is_preview: true }];
    expect(dependencyGraph(withPreview).nodes).toHaveLength(14);
  });
});

describe("Anordnung", () => {
  it("Spalten nebeneinander, Winner Bracket über Loser Bracket, nichts überlappt", () => {
    const graph = dependencyGraph(matches);
    const layout = flowLayout(graph, { columnWidth: 170, nodeWidth: 136, nodeHeight: 56, gap: 12 });
    const at = (key) => layout.positions[graph.nodes.find((node) => node.key === key).id];
    expect(at("E").x - at("A").x).toBe(170);
    expect(at("E").y).toBeLessThan(at("LA").y);
    const boxes = Object.values(layout.positions);
    for (const a of boxes) for (const b of boxes) {
      if (a === b || a.x !== b.x) continue;
      expect(Math.abs(a.y - b.y)).toBeGreaterThanOrEqual(56 + 12);
    }
    expect(layout.width).toBe(6 * 170);
  });

  it("Worst Case: 47 Spiele bleiben lesbar - jede Spalte hat Platz für ihre Knoten", () => {
    const graph = dependencyGraph(fixture.big.matches);
    const layout = flowLayout(graph, { columnWidth: 170, nodeWidth: 136, nodeHeight: 56, gap: 12 });
    expect(graph.nodes.length).toBeGreaterThanOrEqual(40);
    const columns = Math.max(...graph.nodes.map((node) => node.depth)) + 1;
    expect(layout.width).toBe(columns * 170);
    expect(Object.values(layout.positions).every((box) => box.y + 56 <= layout.height)).toBe(true);
  });
});
