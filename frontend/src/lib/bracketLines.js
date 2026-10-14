// Linienführung im Turnierbaum (#1561): rechtwinklig und nur durch freie Flächen - keine Strecke schneidet eine Karte.
// Normalfall: der Knick in der Gasse zwischen zwei Spalten. Geht das nicht (Abstieg ins Loser Bracket, Linie über einen
// Abschnitt hinweg), führt die Linie waagrecht in die Gasse neben dem Quellspiel, dort senkrecht bis in eine freie
// Querbahn (die Lücke zwischen zwei Abschnitten), darin zur Gasse vor dem Zielspiel und erst dort hinein. Mehrere Linien
// in derselben Gasse oder Bahn liegen leicht versetzt („Spuren“). Reine Rechnung auf gemessenen Rechtecken.

const INSET = 1;

/** Schneidet die waagrechte oder senkrechte Strecke p→q das Innere des Rechtecks? Berühren der Kante zählt nicht. */
export function segmentHitsRect(p, q, rect) {
  const left = rect.left + INSET;
  const right = rect.right - INSET;
  const top = rect.top + INSET;
  const bottom = rect.bottom - INSET;
  if (p.y === q.y) {
    const [x1, x2] = p.x < q.x ? [p.x, q.x] : [q.x, p.x];
    return p.y > top && p.y < bottom && x2 > left && x1 < right;
  }
  const [y1, y2] = p.y < q.y ? [p.y, q.y] : [q.y, p.y];
  return p.x > left && p.x < right && y2 > top && y1 < bottom;
}

/** Trifft einer der Abschnitte des Linienzugs eines der Hindernisse? */
export function pathHits(points, obstacles) {
  for (let index = 0; index < points.length - 1; index += 1) {
    for (const rect of obstacles) if (segmentHitsRect(points[index], points[index + 1], rect)) return true;
  }
  return false;
}

/** Ein Linienzug als SVG-Pfad. */
export function toPath(points) {
  return points.map((point, index) => `${index ? "L" : "M"}${Math.round(point.x * 10) / 10} ${Math.round(point.y * 10) / 10}`).join(" ");
}

/** Spur-Verteiler: je Gasse bzw. Querbahn bekommt jede weitere Linie den nächsten Versatz. */
export function laneCounter() {
  const used = new Map();
  return (key) => {
    const count = used.get(key) || 0;
    used.set(key, count + 1);
    return count;
  };
}

/**
 * Der Weg einer Linie von Karte `a` zu Karte `b` (Rechtecke im selben Koordinatensystem). `toY`: Höhe, auf der die
 * Linie in `b` endet (Zeile des Platzes). `obstacles`: alle Karten. `corridors`: freie Querbahnen (y-Werte), `gap`:
 * Breite der Gassen. `preferCorridor`: gleich über Gasse und Querbahn führen (Abstieg ins Loser Bracket).
 * Liefert Punkte; ohne freien Weg den einfachen Knick.
 */
export function routeEdge({ a, b, toY, fromY, obstacles = [], corridors = [], gap = 48, lanes = laneCounter(), preferCorridor = false }) {
  const others = obstacles.filter((rect) => rect !== a && rect !== b);
  const startY = fromY ?? a.top + a.height / 2;
  const endY = toY ?? b.top + b.height / 2;
  const simple = () => {
    const x1 = a.right;
    const x2 = b.left;
    const mid = x2 > x1 ? x1 + (x2 - x1) / 2 : x1 + gap / 2;
    return [{ x: x1, y: startY }, { x: mid, y: startY }, { x: mid, y: endY }, { x: x2, y: endY }];
  };
  if (!preferCorridor && b.left > a.right) {
    const points = simple();
    if (!pathHits(points, others)) return points;
  }
  // Gasse rechts neben der Quelle; die Mitte gehört den normalen Knicken, Spuren liegen links davon.
  const outKey = `out:${Math.round(a.right)}`;
  const gx1 = a.right + 8 + (lanes(outKey) % 4) * 4;
  // Ziel: Gasse links vor der Zielkarte - gibt es links keine (erste Spalte), dann rechts daneben.
  const enterLeft = b.left - gap > -1;
  const inKey = `in:${Math.round(enterLeft ? b.left : b.right)}`;
  const inLane = (lanes(inKey) % 4) * 4;
  const gx2 = enterLeft ? b.left - 8 - inLane : b.right + 8 + inLane;
  const xEnd = enterLeft ? b.left : b.right;
  const candidates = [...corridors].sort((p, q) => (Math.abs(p - startY) + Math.abs(p - endY)) - (Math.abs(q - startY) + Math.abs(q - endY)));
  for (const corridor of candidates) {
    const y = corridor + ((lanes(`row:${Math.round(corridor)}`) % 5) - 2) * 3;
    const points = [{ x: a.right, y: startY }, { x: gx1, y: startY }, { x: gx1, y }, { x: gx2, y }, { x: gx2, y: endY }, { x: xEnd, y: endY }];
    if (!pathHits(points, others) && !pathHits(points.slice(1, -1), [a, b])) return points;
  }
  return simple();
}

/**
 * Die Sammelschiene einer gemischten Gruppe (#1548): eine senkrechte Linie in der Gasse vor den Zielspielen, je
 * Quellspiel ein Ast hinauf, je Zielspiel ein Ast hinaus. Quellen aus demselben Abschnitt münden waagrecht (oder über
 * Gasse und Lücke, wenn Karten im Weg sind); Quellen aus einem anderen Abschnitt (Abstieg ins Loser Bracket) kommen wie
 * jeder Abstieg über Gasse und Lücke an. `sources`/`targets`: `{ id, rect, cross }`; `slotYs`: Höhen, auf denen echte
 * Linien in die Ziele münden (die Schiene reicht bis dorthin).
 * Liefert `{ x, spine, branchesIn: Map, branchesOut: Map, via(a, cross, yEnd, b) }` - `via` baut die echte Linie eines
 * Spielers über die Schiene.
 */
export function routeBus({ sources = [], targets = [], slotYs = [], obstacles = [], corridors = [], gap = 48, lanes = laneCounter() }) {
  const left = Math.min(...targets.map((target) => target.rect.left));
  const x = left - gap / 2;
  const point = (y) => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 });
  const center = (rect) => rect.top + rect.height / 2;
  const branch = (rect, cross, y) => {
    if (!cross && rect.right <= x) {
      const straight = [{ x: rect.right, y: center(rect) }, { x, y: center(rect) }];
      if (!pathHits(straight, obstacles.filter((other) => other !== rect))) return straight;
    }
    return routeEdge({ a: rect, b: point(y), toY: y, fromY: cross ? rect.bottom - 10 : undefined, obstacles, corridors, gap, lanes, preferCorridor: true });
  };
  const ys = [...targets.map((target) => center(target.rect)), ...slotYs];
  const top = Math.min(...ys);
  const branchesIn = new Map();
  for (const source of sources) {
    const points = branch(source.rect, source.cross, source.cross ? top : center(source.rect));
    branchesIn.set(source.id, points);
    ys.push(points[points.length - 1].y);
  }
  const spine = [{ x, y: Math.min(...ys) }, { x, y: Math.max(...ys) }];
  const branchesOut = new Map(targets.map((target) => [target.id, [{ x, y: center(target.rect) }, { x: target.rect.left, y: center(target.rect) }]]));
  /** Die echte Linie: Ast aus der Quelle, die Schiene entlang, Ast in den Platz. */
  const via = (rect, cross, yEnd, target) => {
    const first = branch(rect, cross, cross ? top : center(rect));
    const end = first[first.length - 1];
    return [...first, { x, y: end.y }, { x, y: yEnd }, { x: target.left, y: yEnd }].filter((p, index, list) => index === 0 || p.x !== list[index - 1].x || p.y !== list[index - 1].y);
  };
  return { x, spine, branchesIn, branchesOut, via };
}

/**
 * Alle Linien einer Leinwand (#1561, #1564) - eine Rechnung für Web-Baum und TV: je gemischter Gruppe die
 * Sammelschiene (Schiene, Äste hinein und hinaus), je echter Linie der Weg (über die Schiene, sonst mit routeEdge; der
 * Abstieg ins Loser Bracket beginnt unten an der Karte und nimmt Gasse und Lücke). Alles in denselben Koordinaten:
 * `nodes` (Kennung → Rechteck), `slotY(matchId, slot)` (Höhe der Zeile oder `undefined`), `corridors`, `obstacles`.
 * `rails` aus bracketGraph.drawRails, `matchOf(id)` das Spiel, `columnOf` die Spalte (für die Reihenfolge des Zeichnens).
 * Liefert Linien `{ ...edge, points, d, column }`; die Schiene als `spine`, ihre Äste mit `scaffold` „in“/„out“.
 */
export function stageLines({ edges = [], rails = [], nodes, slotY = () => undefined, corridors = [], obstacles = [], gap = 48, columnOf = new Map(), matchOf = () => null, isVoid = () => false }) {
  const lanes = laneCounter();
  const lines = [];
  const buses = new Map();
  const add = (line, points) => lines.push({ ...line, points, d: toPath(points) });
  for (const rail of rails) {
    const targetIds = rail.targets.filter((id) => nodes.has(id) && !isVoid(id));
    if (!targetIds.length) continue;
    const section = String(matchOf(targetIds[0])?.section || "");
    const sourceIds = [...new Set(rail.sources.map((source) => source.id))].filter((id) => nodes.has(id) && !isVoid(id));
    const sources = sourceIds.map((id) => ({ id, rect: nodes.get(id), cross: String(matchOf(id)?.section || "") !== section }));
    const slotYs = [];
    for (const id of targetIds) {
      for (const slot of matchOf(id)?.slots || []) {
        const y = slotY(id, slot.slot);
        if (y !== undefined) slotYs.push(y);
      }
    }
    const bus = routeBus({ sources, targets: targetIds.map((id) => ({ id, rect: nodes.get(id) })), slotYs, obstacles, corridors, gap, lanes });
    buses.set(rail.group, bus);
    const column = columnOf.get(targetIds[0]) || 0;
    const node = `rail:${rail.group}`;
    add({ id: `${node}:spine`, from: node, to: node, flow: "W", spine: rail.group, column }, bus.spine);
    for (const source of sources) {
      const flow = rail.sources.find((entry) => entry.id === source.id)?.flow || "W";
      add({ id: `${node}:in:${source.id}`, from: source.id, to: node, flow, cross: source.cross, scaffold: "in", railKey: `${rail.group}:${source.id}`, rail: rail.group, column: columnOf.get(source.id) || 0 }, bus.branchesIn.get(source.id));
    }
    for (const id of targetIds) add({ id: `${node}:out:${id}`, from: node, to: id, flow: "W", scaffold: "out", rail: rail.group, column }, bus.branchesOut.get(id));
  }
  for (const edge of edges) {
    const a = nodes.get(edge.from);
    const b = nodes.get(edge.to);
    if (!a || !b) continue;
    const y = slotY(edge.to, edge.toSlot);
    if (edge.rail && buses.has(edge.rail)) {
      // Der echte Weg eines Spielers nach der Auslosung: Ast aus der Quelle, die Schiene entlang, Ast in den Platz.
      add({ ...edge, column: columnOf.get(edge.from) || 0 }, buses.get(edge.rail).via(a, edge.cross, y ?? b.top + b.height / 2, b));
      continue;
    }
    const drop = edge.flow === "L" && edge.cross;
    const points = routeEdge({
      a, b, obstacles, lanes, gap, corridors,
      toY: y,
      // Der Abstieg beginnt unten an der Karte - so liegt er nicht auf dem Knick des Siegers.
      fromY: drop ? a.bottom - 10 : undefined,
      preferCorridor: drop,
    });
    add({ ...edge, column: columnOf.get(edge.from) || 0 }, points);
  }
  return lines;
}
