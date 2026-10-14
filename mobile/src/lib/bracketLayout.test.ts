import fs from "fs";
import path from "path";
import { bracketEdges, drawRails, finalMatchOf, type BracketMatch } from "./bracketGraph";
import { layoutBracket, TROPHY_ID, type BracketLayout } from "./bracketLayout";

// Baum mit Linien (#1563): Lage der Karten und Linien als reine Rechnung - auf echten Bäumen aus dem Generator
// (docs/bracket-trees.json). Keine Karte überdeckt eine andere, keine Linie läuft durch eine Karte, jede Linie endet am
// Platz, in den der Spieler kommt.
type Tree = { matches_v2: BracketMatch[]; stages: any[] };
const TREES: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/bracket-trees.json"), "utf8"));

const ROW = 30;
const heightOf = (match: BracketMatch) => 40 + Math.max(2, (match.slots || []).length) * ROW;
const anchorY = (match: BracketMatch, slot: number) => 40 + (Math.max(1, slot) - 1) * ROW + ROW / 2;

function build(state: string) {
  const tree = TREES[state];
  const edges = bracketEdges(tree.matches_v2);
  const final = finalMatchOf(tree.matches_v2, tree.stages);
  const layout = layoutBracket(tree.matches_v2, edges, { heightOf, anchorY, finalId: final?.id || null });
  return { tree, edges, layout, keyOf: new Map(tree.matches_v2.map((match) => [match.id, match.match_key])) };
}

function overlaps(layout: BracketLayout) {
  const nodes = [...layout.nodes.values()];
  const hits: string[] = [];
  for (const a of nodes) for (const b of nodes) {
    if (a.id >= b.id) continue;
    if (a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h) hits.push(`${a.id}/${b.id}`);
  }
  return hits;
}

function segments(d: string) {
  const points = [...d.matchAll(/[ML](-?[\d.]+) (-?[\d.]+)/g)].map((m) => ({ x: Number(m[1]), y: Number(m[2]) }));
  return points.slice(1).map((point, index) => [points[index], point] as const);
}

function crossings(layout: BracketLayout) {
  const hits: string[] = [];
  for (const line of layout.lines) {
    for (const node of layout.nodes.values()) {
      if (node.id === line.from || node.id === line.to) continue;
      for (const [p, q] of segments(line.d)) {
        const [x1, x2] = [Math.min(p.x, q.x), Math.max(p.x, q.x)];
        const [y1, y2] = [Math.min(p.y, q.y), Math.max(p.y, q.y)];
        if (x2 > node.x + 1 && x1 < node.x + node.w - 1 && y2 > node.y + 1 && y1 < node.y + node.h - 1) hits.push(`${line.id} durch ${node.id}`);
      }
    }
  }
  return hits;
}

test.each(["se6_live", "se6_done", "de4_reset_cancelled", "ffa16", "ffa16_round1", "ffa8_after_merge", "ffa40"])("%s: nichts überdeckt, keine Linie durch eine Karte", (state) => {
  const { layout, edges, tree } = build(state);
  expect(overlaps(layout)).toEqual([]);
  expect(crossings(layout)).toEqual([]);
  // Jede echte Linie wird gezeichnet, dazu die zum Pokal.
  expect(layout.lines.filter((line) => line.to !== TROPHY_ID).length).toBe(edges.length);
  expect(layout.nodes.size).toBe(tree.matches_v2.length + 1);
  expect(layout.width).toBeGreaterThan(0);
  expect(layout.height).toBeGreaterThanOrEqual(Math.max(...[...layout.nodes.values()].map((node) => node.y + node.h)));
});

test("Runden sind Spalten, das Spiel der nächsten Runde steht zwischen seinen Quellen", () => {
  const { layout, tree } = build("se6_live");
  const node = (key: string) => layout.nodes.get(tree.matches_v2.find((match) => match.match_key === key)!.id)!;
  expect(["A", "B", "C", "D"].map((key) => node(key).x)).toEqual([0, 0, 0, 0]);
  expect(node("E").x).toBeGreaterThan(node("A").x);
  expect(node("G").x).toBeGreaterThan(node("E").x);
  const mid = (key: string) => node(key).y + node(key).h / 2;
  expect(mid("E")).toBeCloseTo((mid("A") + mid("B")) / 2, 0);
  expect(mid("G")).toBeCloseTo((mid("E") + mid("F")) / 2, 0);
  // Der Pokal folgt dem Finale, auf seiner Höhe.
  const trophy = layout.nodes.get(TROPHY_ID)!;
  expect(trophy.x).toBeGreaterThan(node("G").x);
  expect(trophy.y + trophy.h / 2).toBeCloseTo(mid("G"), 0);
});

test("Linien enden am Platz, in den der Spieler kommt", () => {
  const { layout, tree } = build("ffa16");
  const id = (key: string) => tree.matches_v2.find((match) => match.match_key === key)!.id;
  const line = layout.lines.find((row) => row.from === id("A") && row.to === id("E") && row.toSlot === 3)!;
  const target = layout.nodes.get(id("E"))!;
  const end = segments(line.d).at(-1)![1];
  expect(end).toEqual({ x: target.x, y: target.y + anchorY(tree.matches_v2[0], 3) });
});

test("Doppel-K.-o.: Loser Bracket unter dem Hauptfeld, Grand Final rechts, Reset leise", () => {
  const { layout, tree } = build("de4_reset_cancelled");
  const node = (key: string) => layout.nodes.get(tree.matches_v2.find((match) => match.match_key === key)!.id)!;
  const mainBottom = Math.max(...["A", "B", "C"].map((key) => node(key).y + node(key).h));
  expect(Math.min(node("LA").y, node("LB").y)).toBeGreaterThan(mainBottom);
  expect(node("GF").x).toBeGreaterThan(Math.max(node("C").x, node("LB").x));
  expect(layout.bands.map((band) => band.label)).toEqual(["Winner Bracket", "Loser Bracket"]);
  const reset = layout.lines.filter((line) => line.to === node("GFR").id);
  expect(reset.length).toBe(2);
  expect(reset.every((line) => line.void)).toBe(true);
});

test("Spaltenköpfe je Runde und Band", () => {
  const { layout, keyOf } = build("de4_reset_cancelled");
  expect(layout.headers.map((header) => header.matchIds.map((id) => keyOf.get(id)).join(""))).toEqual(["AB", "C", "LA", "LB", "GF", "GFR"]);
});

test("leerer Baum", () => {
  const layout = layoutBracket([], [], { heightOf, anchorY, finalId: null });
  expect(layout.nodes.size).toBe(0);
  expect(layout.lines).toEqual([]);
});

// Gemischte Runden (#1548): je Auslosungs-Gruppe eine Sammelschiene in der Gasse vor den Zielspielen. Mehrere Schienen
// in derselben Gasse liegen nebeneinander; die Karten stehen wie im festen Baum.
test.each(["se8_mixed_open", "se8_mixed_drawn", "de8_mixed_r1", "ffa16_mixed_open"])("%s: Sammelschienen, nichts überdeckt, keine Linie durch eine Karte", (state) => {
  const tree = TREES[state];
  const edges = bracketEdges(tree.matches_v2);
  const rails = drawRails(tree.matches_v2);
  const final = finalMatchOf(tree.matches_v2, tree.stages);
  const layout = layoutBracket(tree.matches_v2, edges, { heightOf, anchorY, finalId: final?.id || null, rails, positionEdges: bracketEdges(tree.matches_v2, { schema: true }) });
  expect(overlaps(layout)).toEqual([]);
  const asLines = layout.rails.flatMap((rail) => [
    { id: `${rail.group}-schiene`, from: "", to: "", d: rail.spine },
    ...rail.ins.map((row) => ({ id: `${rail.group}-in-${row.sourceId}`, from: row.sourceId, to: "", d: row.d })),
    ...rail.outs.map((row) => ({ id: `${rail.group}-out-${row.targetId}`, from: "", to: row.targetId, d: row.d })),
  ]);
  expect(crossings({ ...layout, lines: [...layout.lines, ...asLines] as never })).toEqual([]);
  expect(layout.rails.map((rail) => rail.group)).toEqual(rails.map((rail) => rail.group));
  for (const rail of layout.rails) {
    expect(rail.ins.length).toBe(new Set(rails.find((row) => row.group === rail.group)!.sources.map((source) => source.id)).size);
    expect(rail.outs.length).toBe(rails.find((row) => row.group === rail.group)!.targets.length);
  }
  // Gezeichnet werden die Schienen; die echten Linien der Auslosung liegen darauf und erscheinen nur auf deinem Weg.
  expect(layout.lines.filter((line) => line.rail).every((line) => line.hidden)).toBe(true);
});

test("Doppel-K.-o. gemischt: zwei Schienen in derselben Gasse liegen nebeneinander", () => {
  const tree = TREES.de8_mixed_r1;
  const layout = layoutBracket(tree.matches_v2, bracketEdges(tree.matches_v2), {
    heightOf, anchorY, finalId: null, rails: drawRails(tree.matches_v2), positionEdges: bracketEdges(tree.matches_v2, { schema: true }),
  });
  const wb = layout.rails.find((rail) => rail.group === "WB:2")!;
  const lb = layout.rails.find((rail) => rail.group === "LB:2")!;
  expect(wb.x).not.toBe(lb.x);
  const node = (key: string) => layout.nodes.get(tree.matches_v2.find((match) => match.match_key === key)!.id)!;
  // Gemischt gibt es keine feste Paarung: die Zielspiele stehen in ihrer Reihenfolge um die Mitte aller Quellen.
  expect(node("E").y).toBeLessThan(node("F").y);
  expect(node("LC").y).toBeLessThan(node("LD").y);
  const sources = ["A", "B", "C", "D"].map((key) => node(key).y + node(key).h / 2);
  const middle = (Math.min(...sources) + Math.max(...sources)) / 2;
  expect(node("E").y).toBeLessThan(middle);
  expect(node("F").y + node("F").h).toBeGreaterThan(middle);
});
