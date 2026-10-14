import { describe, expect, it } from "vitest";
import { doubleElimination, decide } from "../../e2e/fixtures/tvBrackets.mjs";
import FFA from "../../e2e/fixtures/ffaGenerated.json";
import LINES from "../../e2e/fixtures/bracketLines.json";
import { auditLines } from "./bracketLineAudit.mjs";
import { bracketEdges, drawRails, isCancelled, sectionGroup } from "./bracketGraph";
import { laneCounter, pathHits, routeBus, routeEdge, segmentHitsRect, stageLines } from "./bracketLines";

// Linienführung (#1561): keine Strecke schneidet eine Karte - auch nicht der Abstieg vom Winner ins Loser Bracket.
// Die Rechtecke bilden die Leinwand nach (BracketTree, StageCanvas): Spalten 232 px breit, Gassen 48 px, Abschnitte
// untereinander mit 40 px Lücke, das Grand Final rechts daneben, Karten je Runde gleichmäßig verteilt.

const CARD_W = 232;
const GAP = 48;
const CARD_H = 104;
const ROW = 128;
const HEAD = 52;

function layout(bracket, pad = 0) {
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
  const main = place(left, pad, 0);
  const side = place(right, 0, 0);
  // Rechte Spalte (Grand Final) senkrecht mittig neben der linken.
  const shiftX = pad + main.width + GAP;
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

// Gemischte Gruppen (#1548): die Sammelschiene liegt in der Gasse vor den Zielen, bleibt in ihrem Abschnitt und kreuzt
// keine Karte und keinen Kopf - auch die echten Linien über die Schiene nicht. Echte Daten aus dem Generator.
describe("routeBus: Sammelschiene in der Gasse", () => {
  for (const state of ["se8_draw_before", "se8_draw_after", "de8_draw_before", "de8_draw_after", "ffa16_draw_before", "ffa16_draw_after", "se6_draw_after", "ffa8_shuffle_merged"]) {
    it(`${state}: Schiene, Äste und echte Wege laufen nur durch Gassen und Lücken, die Schiene bleibt im Abschnitt`, () => {
      const bracket = structuredClone(FFA[state]);
      const { rects, sectionRects, heads } = layout(bracket, GAP);
      const obstacles = [...rects.values(), ...heads];
      const corridors = sectionRects.flatMap((rect) => [rect.top - 20, rect.bottom + 20]);
      const byId = new Map(bracket.matches_v2.map((match) => [match.id, match]));
      const rails = drawRails(bracket.matches_v2);
      expect(rails.length).toBeGreaterThan(0);
      const lanes = laneCounter();
      for (const rail of rails) {
        const group = { group: rail.group, targetIds: rail.targets.filter((id) => !isCancelled(byId.get(id))) };
        const targets = group.targetIds.map((id) => ({ id, rect: rects.get(id) }));
        const sources = [...new Set(rail.sources.map((source) => source.id))].filter((id) => !isCancelled(byId.get(id)))
          .map((id) => ({ id, rect: rects.get(id), cross: byId.get(id).section !== byId.get(group.targetIds[0]).section }));
        const bus = routeBus({ sources, targets, obstacles, corridors, gap: GAP, lanes });
        const own = (id) => obstacles.filter((rect) => rect !== rects.get(id));
        expect(pathHits(bus.spine, obstacles), `${group.group} Schiene`).toBe(false);
        for (const [id, points] of bus.branchesIn) expect(pathHits(points, own(id)), `${group.group} Ast aus ${byId.get(id).match_key}`).toBe(false);
        for (const [id, points] of bus.branchesOut) expect(pathHits(points, own(id)), `${group.group} Ast in ${byId.get(id).match_key}`).toBe(false);
        const section = sectionRects.find((rect) => rect.name === byId.get(group.targetIds[0]).section);
        expect(bus.spine[0].y, `${group.group} oben im Abschnitt`).toBeGreaterThanOrEqual(section.top - 20);
        expect(bus.spine[1].y, `${group.group} unten im Abschnitt`).toBeLessThanOrEqual(section.bottom);
        // Nach der Auslosung: der echte Weg jedes Spielers über die Schiene.
        for (const target of group.targetIds.map((id) => byId.get(id))) {
          for (const slot of target.slots.filter((row) => row.registration_id && row.source_result?.from_match_id)) {
            const from = byId.get(slot.source_result.from_match_id);
            const points = bus.via(rects.get(from.id), from.section !== target.section, rects.get(target.id).top + rects.get(target.id).height / 2, rects.get(target.id));
            expect(pathHits(points, obstacles.filter((rect) => rect !== rects.get(from.id) && rect !== rects.get(target.id))), `${state} ${from.match_key} → ${target.match_key}`).toBe(false);
            expect(points.some((p) => p.x === bus.x), "läuft über die Schiene").toBe(true);
          }
        }
      }
    });
  }
});

// Übersicht (#1591): Fälle aus dem echten Generator (bracketLines.json). Sichtbar ist nur, was ohne Zeigen gilt - jede
// Linie hängt an Karte, Schiene oder Marker, nichts doppelt, nichts gedrängt, nichts außerhalb, je Gruppe eine Schiene.
// Abstiege und die Einzelwege einer Gabel kommen erst beim Zeigen (`demand`).
function stageOf(bracket) {
  const { rects, sectionRects, heads } = layout(bracket, GAP);
  const byId = new Map(bracket.matches_v2.map((match) => [match.id, match]));
  const slotY = (id, slot) => {
    const rect = rects.get(id);
    const count = (byId.get(id)?.slots || []).length || 1;
    return rect.top + 30 + ((slot - 0.5) * (rect.height - 30)) / count;
  };
  const columnOf = new Map();
  for (const match of bracket.matches_v2) {
    const rounds = [...new Set(bracket.matches_v2.filter((row) => row.section === match.section).map((row) => row.round))].sort((p, q) => p - q);
    columnOf.set(match.id, rounds.indexOf(match.round));
  }
  const lines = stageLines({
    edges: bracketEdges(bracket.matches_v2),
    rails: drawRails(bracket.matches_v2),
    nodes: rects,
    slotY,
    corridors: sectionRects.flatMap((rect) => [rect.top - 20, rect.bottom + 20]).filter((y) => y > 2),
    obstacles: [...rects.values(), ...heads],
    gap: GAP,
    columnOf,
    matchOf: (id) => byId.get(id),
    isVoid: (id) => isCancelled(byId.get(id)),
  });
  const all = [...rects.values(), ...sectionRects];
  const bounds = { w: Math.max(...all.map((rect) => rect.right)) + GAP, h: Math.max(...all.map((rect) => rect.bottom)) + GAP };
  return { lines, rects, heads, byId, bounds };
}

const visibleAudit = ({ lines, rects, heads, bounds }) => auditLines({
  lines: lines.filter((line) => !line.demand),
  boxes: [...rects.values()],
  obstacles: heads,
  markers: lines.filter((line) => line.marker && !line.demand).map((line) => line.marker),
  bounds,
});

describe("stageLines: übersichtlich (#1591)", () => {
  for (const state of ["ffa16de_start", "ffa16de_round1", "se8_fixed", "de8_fixed", "ffa8_merged"]) {
    it(`${state}: sichtbare Linien hängen an, nichts doppelt, nichts gedrängt, nichts außerhalb, eine Schiene je Gruppe`, () => {
      expect(visibleAudit(stageOf(structuredClone(LINES[state])))).toEqual([]);
    });
  }

  it("Abstiege ins Loser Bracket kommen erst beim Zeigen - am Ziel steht ein Eingang mit Marker", () => {
    const { lines, byId } = stageOf(structuredClone(LINES.de8_fixed));
    const drops = lines.filter((line) => line.flow === "L" && line.cross && !line.stub);
    expect(drops.length).toBeGreaterThan(0);
    expect(drops.every((line) => line.demand)).toBe(true);
    const stubs = lines.filter((line) => line.stub && !line.demand);
    for (const drop of drops) {
      expect(stubs.some((stub) => stub.to === drop.to && stub.toSlot === drop.toSlot), `Eingang in ${byId.get(drop.to).match_key}`).toBe(true);
    }
    for (const stub of stubs) {
      expect(stub.marker).toEqual(stub.points[0]);
      expect(stub.points[1].x - stub.points[0].x).toBeGreaterThan(0);
    }
  });

  it("gemischt: Äste aus einem anderen Abschnitt kommen erst beim Zeigen, die Schiene bekommt einen Eingang", () => {
    const { lines, byId } = stageOf(structuredClone(LINES.ffa16de_start));
    const crossIn = lines.filter((line) => line.scaffold === "in" && line.cross);
    expect(crossIn.length).toBeGreaterThan(0);
    expect(crossIn.every((line) => line.demand)).toBe(true);
    const keyOf = (key) => lines.find((line) => line.spine && byId.get(drawRails(LINES.ffa16de_start.matches_v2).find((rail) => rail.key === line.spine)?.targets[0])?.match_key === key)?.spine;
    for (const key of ["LA", "LC"]) {
      const spine = lines.find((line) => line.spine === keyOf(key));
      const entry = lines.find((line) => line.stub && line.to === `rail:${spine.spine}`);
      expect(entry, `Eingang der Schiene vor ${key}`).toBeTruthy();
      expect(entry.points[1]).toEqual(spine.points[0]);
    }
    // Die Weiterkommer aus der eigenen Runde (LA, LB → LC/LD) bleiben als Ast sichtbar.
    expect(lines.filter((line) => line.scaffold === "in" && !line.cross && !line.demand).length).toBeGreaterThan(0);
  });

  it("mehrere Plätze aus einem Spiel in dasselbe Ziel: eine Gabel statt doppelter Strecken, die Einzelwege beim Zeigen", () => {
    const { lines, byId } = stageOf(structuredClone(LINES.ffa16de_start));
    const g = [...byId.values()].find((match) => match.match_key === "G");
    const final = [...byId.values()].find((match) => match.match_key === "FINAL");
    const members = lines.filter((line) => line.from === g.id && line.to === final.id && !line.fork);
    expect(members).toHaveLength(2);
    expect(members.every((line) => line.demand)).toBe(true);
    const fork = lines.filter((line) => line.fork && line.from === g.id);
    expect(fork.length).toBeGreaterThanOrEqual(3);
    expect(fork.some((line) => line.demand)).toBe(false);
  });

  it("liegt das Ziel direkt unter der Quelle (Grand Final → Sieger), führt die Linie kurz und gerade hinunter", () => {
    const a = { left: 100, right: 332, top: 0, bottom: 200, width: 232, height: 200 };
    const b = { left: 100, right: 332, top: 240, bottom: 300, width: 232, height: 60 };
    const points = routeEdge({ a, b, obstacles: [a, b], corridors: [400], gap: GAP });
    expect(points).toHaveLength(2);
    expect(points[0].x).toBe(points[1].x);
    expect(points[0].y).toBe(200);
    expect(points[1].y).toBe(240);
    // Mit Reset steht das letzte Spiel rechts daneben: aus der Unterkante hinunter, in der Lücke hinüber, hinein.
    const reset = { left: 380, right: 612, top: 0, bottom: 200, width: 232, height: 200 };
    const bent = routeEdge({ a: reset, b, obstacles: [reset, b], corridors: [400], gap: GAP });
    expect(bent).toEqual([{ x: 496, y: 200 }, { x: 496, y: 220 }, { x: 216, y: 220 }, { x: 216, y: 240 }]);
  });

  it("die Weiterkommer verlassen einen Lauf auf der Höhe der Zeile „kommen weiter“", () => {
    const bracket = structuredClone(LINES.se8_fixed);
    const { rects, byId } = stageOf(bracket);
    const a = [...byId.values()].find((match) => match.match_key === "A");
    const lines = stageLines({
      edges: bracketEdges(bracket.matches_v2), rails: [], nodes: rects, gap: GAP,
      exitY: (id, flow) => (id === a.id && flow === "W" ? rects.get(id).top + 77 : undefined),
      matchOf: (id) => byId.get(id),
    });
    const out = lines.find((line) => line.from === a.id && !line.demand);
    expect(out.points[0].y).toBe(rects.get(a.id).top + 77);
  });
});

describe("stageLines: Schiene ohne Knick", () => {
  it("liegt ein Ast fast auf der Höhe eines Ziels, läuft er gerade durch statt mit kleinem Versatz", () => {
    const rect = (left, top) => ({ left, top, right: left + 232, bottom: top + 200, width: 232, height: 200 });
    const nodes = new Map([["la", rect(0, 0)], ["lb", rect(0, 240)], ["lc", rect(280, 0)], ["ld", rect(280, 240)]]);
    const matches = new Map([["la", { section: "LB" }], ["lb", { section: "LB" }], ["lc", { section: "LB" }], ["ld", { section: "LB" }]]);
    const rails = [{ key: "s/LB:2", group: "LB:2", sources: [{ id: "la", flow: "W" }, { id: "lb", flow: "W" }], targets: ["lc", "ld"] }];
    const lines = stageLines({ rails, nodes, gap: GAP, exitY: (id) => nodes.get(id).top + 106, matchOf: (id) => matches.get(id) });
    const into = lines.find((line) => line.id === "rail:s/LB:2:in:la");
    const out = lines.find((line) => line.id === "rail:s/LB:2:out:lc");
    expect(out.points[0].y).toBe(into.points.at(-1).y);
    expect(auditLines({ lines, boxes: [...nodes.values()] })).toEqual([]);
  });
});
