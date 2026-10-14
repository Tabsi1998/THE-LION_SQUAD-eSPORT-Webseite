import { describe, expect, it } from "vitest";
import { doubleElimination, decide } from "../../e2e/fixtures/tvBrackets.mjs";
import { bracketEdges, sectionGroup } from "./bracketGraph";
import { laneCounter, pathHits, routeEdge, segmentHitsRect } from "./bracketLines";

// Linienführung (#1561): keine Strecke schneidet eine Karte - auch nicht der Abstieg vom Winner ins Loser Bracket.
// Die Rechtecke bilden die Leinwand nach (BracketTree, StageCanvas): Spalten 232 px breit, Gassen 48 px, Abschnitte
// untereinander mit 40 px Lücke, das Grand Final rechts daneben, Karten je Runde gleichmäßig verteilt.

const CARD_W = 232;
const GAP = 48;
const CARD_H = 104;
const ROW = 128;
const HEAD = 52;

function layout(bracket) {
  const sections = new Map();
  for (const match of bracket.matches_v2) {
    const name = match.section;
    if (!sections.has(name)) sections.set(name, new Map());
    const rounds = sections.get(name);
    if (!rounds.has(match.round)) rounds.set(match.round, []);
    rounds.get(match.round).push(match);
  }
  const rects = new Map();
  const sectionRects = [];
  const heads = [];
  const left = [...sections.keys()].filter((name) => ["main", "loser"].includes(sectionGroup(name)));
  const right = [...sections.keys()].filter((name) => !left.includes(name));
  const place = (names, x0, y0) => {
    let y = y0;
    let width = 0;
    for (const name of names) {
      const rounds = [...sections.get(name).entries()].sort((p, q) => p[0] - q[0]).map(([, list]) => list.sort((p, q) => p.order - q.order));
      const rows = Math.max(...rounds.map((list) => list.length));
      const height = HEAD + rows * ROW;
      // Kopf: Titel und Erklärzeile (eine Kartenbreite, drei Zeilen), darunter je Spalte der Rundentitel.
      heads.push({ left: x0, right: x0 + CARD_W, top: y, bottom: y + 34, width: CARD_W, height: 34, section: name });
      rounds.forEach((list, column) => {
        heads.push({ left: x0 + column * (CARD_W + GAP), right: x0 + column * (CARD_W + GAP) + CARD_W, top: y + 38, bottom: y + 50, width: CARD_W, height: 12, section: name });
        const share = (rows * ROW) / list.length;
        list.forEach((match, index) => {
          const top = y + HEAD + index * share + (share - CARD_H) / 2;
          const x = x0 + column * (CARD_W + GAP);
          rects.set(match.id, { left: x, right: x + CARD_W, top, bottom: top + CARD_H, width: CARD_W, height: CARD_H });
        });
      });
      const sectionWidth = rounds.length * (CARD_W + GAP) - GAP;
      sectionRects.push({ name, left: x0, right: x0 + sectionWidth, top: y, bottom: y + height });
      width = Math.max(width, sectionWidth);
      y += height + 40;
    }
    return { width, height: y - 40 - y0 };
  };
  const main = place(left, 0, 0);
  const side = place(right, 0, 0);
  // Rechte Spalte (Grand Final) senkrecht mittig neben der linken.
  const shiftX = main.width + GAP;
  const shiftY = (main.height - side.height) / 2;
  for (const name of right) {
    const section = sectionRects.find((entry) => entry.name === name);
    Object.assign(section, { left: section.left + shiftX, right: section.right + shiftX, top: section.top + shiftY, bottom: section.bottom + shiftY });
    for (const match of bracket.matches_v2.filter((row) => row.section === name)) {
      const rect = rects.get(match.id);
      rects.set(match.id, { ...rect, left: rect.left + shiftX, right: rect.right + shiftX, top: rect.top + shiftY, bottom: rect.bottom + shiftY });
    }
    for (const head of heads.filter((entry) => entry.section === name)) {
      Object.assign(head, { left: head.left + shiftX, right: head.right + shiftX, top: head.top + shiftY, bottom: head.bottom + shiftY });
    }
  }
  return { rects, sectionRects, heads };
}

function routeAll(bracket) {
  const { rects, sectionRects, heads } = layout(bracket);
  const obstacles = [...rects.values(), ...heads];
  const corridors = sectionRects.flatMap((rect) => [rect.top - 20, rect.bottom + 20]);
  const lanes = laneCounter();
  return bracketEdges(bracket.matches_v2).map((edge) => {
    const a = rects.get(edge.from);
    const b = rects.get(edge.to);
    const drop = edge.flow === "L" && edge.cross;
    const points = routeEdge({ a, b, fromY: drop ? a.bottom - 10 : undefined, obstacles, corridors, gap: GAP, lanes, preferCorridor: drop });
    return { edge, points, a, b, obstacles, heads };
  });
}

describe("segmentHitsRect", () => {
  it("Berühren der Kante ist erlaubt, Durchqueren nicht", () => {
    const rect = { left: 0, right: 100, top: 0, bottom: 50 };
    expect(segmentHitsRect({ x: -10, y: 25 }, { x: 110, y: 25 }, rect)).toBe(true);
    expect(segmentHitsRect({ x: 100, y: 0 }, { x: 100, y: 50 }, rect)).toBe(false);
    expect(segmentHitsRect({ x: 50, y: -20 }, { x: 50, y: 0 }, rect)).toBe(false);
  });
});

describe("routeEdge: keine Linie schneidet eine Karte", () => {
  for (const size of [8, 16]) {
    it(`Doppel-K.-o. mit ${size}: alle Linien, auch der Abstieg ins Loser Bracket, laufen nur durch Gassen und Lücken`, () => {
      const bracket = decide(doubleElimination(size, { reset: true }), "A");
      const routes = routeAll(bracket);
      const drops = routes.filter((route) => route.edge.flow === "L" && route.edge.cross);
      expect(drops.length).toBeGreaterThan(0);
      for (const { edge, points, a, b, obstacles } of routes) {
        const others = obstacles.filter((rect) => rect !== a && rect !== b);
        expect(pathHits(points, others), `${edge.from} → ${edge.to}`).toBe(false);
        // Auch die eigenen Karten werden nur an der Kante berührt.
        expect(pathHits(points.slice(1, -1), [a, b]), `${edge.from} → ${edge.to} (eigene Karten)`).toBe(false);
        // Die Köpfe der Abschnitte (Titel, Erklärzeile, Rundentitel) bleiben frei.
        for (const head of routes[0].heads) expect(pathHits(points, [head]), `${edge.from} → ${edge.to} durch den Kopf von ${head.section}`).toBe(false);
        // Nur rechte Winkel.
        for (let index = 0; index < points.length - 1; index += 1) {
          expect(points[index].x === points[index + 1].x || points[index].y === points[index + 1].y).toBe(true);
        }
      }
    });
  }

  it("mehrere Abstiege aus derselben Gasse liegen versetzt, nicht übereinander", () => {
    const routes = routeAll(doubleElimination(16, { reset: true })).filter((route) => route.edge.flow === "L" && route.edge.cross);
    const byGutter = new Map();
    for (const { a, points } of routes) {
      const key = Math.round(a.right);
      if (!byGutter.has(key)) byGutter.set(key, new Set());
      byGutter.get(key).add(points[1].x);
    }
    const shared = [...byGutter.values()].filter((set) => set.size > 1);
    expect(shared.length).toBeGreaterThan(0);
  });
});
