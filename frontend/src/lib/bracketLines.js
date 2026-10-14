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
  // Liegt das Ziel direkt darunter und hat keine Zeile (Grand Final → Sieger, #1591): kurz und gerade hinunter.
  const overlapLeft = Math.max(a.left, b.left);
  const overlapRight = Math.min(a.right, b.right);
  if (!preferCorridor && toY == null && b.top >= a.bottom - 0.5) {
    if (overlapRight - overlapLeft > 16) {
      const x = overlapLeft + (overlapRight - overlapLeft) / 2;
      const points = [{ x, y: a.bottom }, { x, y: b.top }];
      if (!pathHits(points, others)) return points;
    }
    // Schräg darunter (Reset rechts neben dem Grand Final): aus der Unterkante hinunter, in der Lücke hinüber, hinein.
    const x1 = a.left + a.width / 2;
    const x2 = b.left + b.width / 2;
    const y = a.bottom + (b.top - a.bottom) / 2;
    const points = [{ x: x1, y: a.bottom }, { x: x1, y }, { x: x2, y }, { x: x2, y: b.top }];
    if (b.top - a.bottom >= 8 && !pathHits(points, others)) return points;
  }
  // Ziel in derselben Spalte darüber oder darunter, mit Zeile (Grand Final über der letzten Loser-Spalte, #1591): rechts
  // aus der Quelle, in der Gasse daneben hinauf bzw. hinunter, von rechts in den Platz - kurz, ohne Umweg über die Lücke.
  if (!preferCorridor && toY != null && overlapRight - overlapLeft > 16 && (b.bottom <= a.top || b.top >= a.bottom)) {
    const x = Math.max(a.right, b.right) + gap / 2;
    const points = [{ x: a.right, y: startY }, { x, y: startY }, { x, y: endY }, { x: b.right, y: endY }];
    if (!pathHits(points, others)) return points;
  }
  if (!preferCorridor && b.left > a.right) {
    const points = simple();
    if (!pathHits(points, others)) return points;
  }
  // Gasse rechts neben der Quelle; die Mitte gehört den normalen Knicken, Spuren liegen links davon.
  const outKey = `out:${Math.round(a.right)}`;
  // Spuren 8 px auseinander (#1591): zwei gestrichelte Abstiege nebeneinander bleiben zwei lesbare Linien.
  const gx1 = a.right + 6 + (lanes(outKey) % 2) * 8;
  // Ziel: Gasse links vor der Zielkarte - gibt es links keine (erste Spalte), dann rechts daneben.
  const enterLeft = b.left - gap > -1;
  // Alle Wege in dieselbe Karte nehmen dieselbe Senkrechte davor (#1591) - dort laufen sie zu einer Gabel zusammen,
  // statt als Spuren dicht nebeneinander.
  const gx2 = enterLeft ? b.left - 8 : b.right + 8;
  const xEnd = enterLeft ? b.left : b.right;
  const candidates = [...corridors].sort((p, q) => (Math.abs(p - startY) + Math.abs(p - endY)) - (Math.abs(q - startY) + Math.abs(q - endY)));
  for (const corridor of candidates) {
    const y = corridor + ((lanes(`row:${Math.round(corridor)}`) % 3) - 1) * 8;
    const points = [{ x: a.right, y: startY }, { x: gx1, y: startY }, { x: gx1, y }, { x: gx2, y }, { x: gx2, y: endY }, { x: xEnd, y: endY }];
    if (!pathHits(points, others) && !pathHits(points.slice(1, -1), [a, b])) return points;
  }
  return simple();
}

/**
 * Die Sammelschiene einer gemischten Gruppe (#1548): eine senkrechte Linie in der Gasse vor den Zielspielen, je
 * Quellspiel ein Ast hinauf, je Zielspiel ein Ast hinaus. Quellen aus demselben Abschnitt münden waagrecht (oder über
 * Gasse und Lücke, wenn Karten im Weg sind); Quellen aus einem anderen Abschnitt (Abstieg ins Loser Bracket) kommen wie
 * jeder Abstieg über Gasse und Lücke an und münden oben an der Schiene. `sources`: `{ id, rect, cross, y }` (`y`: Höhe,
 * auf der der Ast die Quelle verlässt - sonst die Mitte), `targets`: `{ id, rect }`; `slotYs`: Höhen, auf denen echte
 * Linien in die Ziele münden (die Schiene reicht bis dorthin).
 * Liefert `{ x, spine, branchesIn: Map, branchesOut: Map, via(a, cross, yEnd, b) }` - `via` baut die echte Linie eines
 * Spielers über die Schiene.
 */
export function routeBus({ sources = [], targets = [], slotYs = [], obstacles = [], corridors = [], gap = 48, lanes = laneCounter() }) {
  const left = Math.min(...targets.map((target) => target.rect.left));
  const x = left - gap / 2;
  const point = (y) => ({ left: x, right: x, top: y, bottom: y, width: 0, height: 0 });
  const center = (rect) => rect.top + rect.height / 2;
  const branch = (rect, cross, y, fromY) => {
    if (!cross && rect.right <= x) {
      const at = fromY ?? center(rect);
      const straight = [{ x: rect.right, y: at }, { x, y: at }];
      if (!pathHits(straight, obstacles.filter((other) => other !== rect))) return straight;
    }
    return routeEdge({ a: rect, b: point(y), toY: y, fromY: cross ? (fromY ?? rect.bottom - 10) : fromY, obstacles, corridors, gap, lanes, preferCorridor: true });
  };
  const ys = [...targets.map((target) => center(target.rect)), ...slotYs];
  const top = Math.min(...targets.map((target) => center(target.rect)));
  const fromYOf = new Map(sources.map((source) => [source.id, source.y]));
  const branchesIn = new Map();
  for (const source of sources) {
    const points = branch(source.rect, source.cross, source.cross ? top : (source.y ?? center(source.rect)), source.y);
    branchesIn.set(source.id, points);
    ys.push(points[points.length - 1].y);
  }
  const spine = [{ x, y: Math.min(...ys) }, { x, y: Math.max(...ys) }];
  const branchesOut = new Map(targets.map((target) => [target.id, [{ x, y: center(target.rect) }, { x: target.rect.left, y: center(target.rect) }]]));
  /** Die echte Linie: Ast aus der Quelle, die Schiene entlang, Ast in den Platz. */
  const via = (rect, cross, yEnd, target, id) => {
    const fromY = fromYOf.get(id);
    const first = branch(rect, cross, cross ? top : (fromY ?? center(rect)), fromY);
    const end = first[first.length - 1];
    return [...first, { x, y: end.y }, { x, y: yEnd }, { x: target.left, y: yEnd }].filter((p, index, list) => index === 0 || p.x !== list[index - 1].x || p.y !== list[index - 1].y);
  };
  return { x, top, spine, branchesIn, branchesOut, via };
}

/** Länge eines Eingangs (#1591): kurzer Strich mit Marker am freien Ende. */
export const STUB = 12;

/**
 * Alle Linien einer Leinwand (#1561, #1564, #1591) - eine Rechnung für Web-Baum und TV. Alles in denselben Koordinaten:
 * `nodes` (Kennung → Rechteck), `slotY(matchId, slot)` (Höhe der Zeile oder `undefined`), `exitY(matchId, flow)` (Höhe,
 * auf der Weiterkommer bzw. die anderen eine Karte verlassen - die Zeile „kommen weiter“ bzw. „Die anderen …“),
 * `corridors`, `obstacles`. `rails` aus bracketGraph.drawRails, `matchOf(id)` das Spiel, `columnOf` die Spalte.
 *
 * Sichtbar ist das Gerüst, das man ohne Zeigen lesen kann: je gemischter Gruppe genau eine Schiene mit ihren Ästen aus
 * dem eigenen Abschnitt und in die Ziele; je Spiel, das mehrere Plätze in dasselbe Ziel schickt, eine Gabel (Stamm,
 * Querstrich, Äste) statt doppelter Strecken; sonst die Linie selbst. Erst beim Zeigen auf eine Karte, im Weg-Modus oder
 * während einer Bewegung kommen dazu (`demand`): der Abstieg ins Loser Bracket (am Ziel steht dafür ein Eingang - ein
 * kurzer Strich mit Marker `marker`; an der Quelle „Die anderen → …“), die Äste aus einem anderen Abschnitt in eine
 * Schiene (die Schiene bekommt oben einen Eingang), die echten Wege über die Schiene und die Einzelwege einer Gabel.
 * `rel`: die Karten, bei deren Zeigen eine Linie erscheint.
 * Liefert Linien `{ ...edge, points, d, column }`; Schiene `spine`, ihre Äste `scaffold` „in“/„out“, Gabel `fork`,
 * Eingang `stub`.
 */
export function stageLines({ edges = [], rails = [], nodes, slotY = () => undefined, exitY = () => undefined, corridors = [], obstacles = [], gap = 48, columnOf = new Map(), matchOf = () => null, isVoid = () => false }) {
  const lanes = laneCounter();
  const lines = [];
  const buses = new Map();
  const add = (line, points) => lines.push({ ...line, points, d: toPath(points) });
  for (const rail of rails) {
    const targetIds = rail.targets.filter((id) => nodes.has(id) && !isVoid(id));
    if (!targetIds.length) continue;
    const section = String(matchOf(targetIds[0])?.section || "");
    const sourceIds = [...new Set(rail.sources.map((source) => source.id))].filter((id) => nodes.has(id) && !isVoid(id));
    const flowOf = (id) => rail.sources.find((entry) => entry.id === id)?.flow || "W";
    const sources = sourceIds.map((id) => {
      const cross = String(matchOf(id)?.section || "") !== section;
      return { id, rect: nodes.get(id), cross, y: exitY(id, flowOf(id)) };
    });
    const slotYs = [];
    for (const id of targetIds) {
      for (const slot of matchOf(id)?.slots || []) {
        const y = slotY(id, slot.slot);
        if (y !== undefined) slotYs.push(y);
      }
    }
    const bus = routeBus({ sources, targets: targetIds.map((id) => ({ id, rect: nodes.get(id) })), slotYs, obstacles, corridors, gap, lanes });
    // Je Phase getrennt (#1561): `key` = Phase und Gruppe; ältere Schienen ohne Schlüssel nehmen die Gruppe.
    const railKey = rail.key || rail.group;
    buses.set(railKey, bus);
    const column = columnOf.get(targetIds[0]) || 0;
    const node = `rail:${railKey}`;
    // Sichtbar reicht die Schiene genau von Ast zu Ast (#1591) - nicht bis zu Zeilen, in die erst die echten Wege münden.
    const center = (rect) => rect.top + rect.height / 2;
    const inYs = sources.filter((source) => !source.cross).map((source) => bus.branchesIn.get(source.id).at(-1).y);
    // Liegt ein Ast fast auf der Höhe eines Ziels, läuft er gerade durch - kein kleiner Versatz an der Schiene.
    const outY = new Map(targetIds.map((id) => {
      const rect = nodes.get(id);
      const near = inYs.filter((y) => Math.abs(y - center(rect)) <= 16 && y > rect.top + 8 && y < rect.bottom - 8)
        .sort((p, q) => Math.abs(p - center(rect)) - Math.abs(q - center(rect)))[0];
      return [id, near ?? center(rect)];
    }));
    const seen = [...outY.values(), ...inYs];
    const crossing = sources.some((source) => source.cross);
    const spineTop = Math.min(...seen);
    const spineBottom = Math.max(...seen);
    if (crossing) {
      // Eingang oben an der Schiene: hier kommen die Plätze aus einem anderen Abschnitt an (Abstieg).
      const entry = [{ x: bus.x, y: spineTop - STUB }, { x: bus.x, y: spineTop }];
      add({ id: `${node}:entry`, from: node, to: node, flow: "L", stub: true, marker: entry[0], rail: railKey, rel: [...targetIds, ...sources.filter((source) => source.cross).map((source) => source.id)], column }, entry);
    }
    add({ id: `${node}:spine`, from: node, to: node, flow: "W", spine: railKey, railGroup: rail.group, column }, [{ x: bus.x, y: spineTop }, { x: bus.x, y: spineBottom }]);
    const entryY = spineTop - STUB;
    // Ein Abstieg mündet genau in den Eingang oben an der Schiene - nur waagrecht und senkrecht (#1591).
    const intoEntry = (points) => {
      const out = points.map((point) => ({ ...point }));
      const n = out.length;
      if (n >= 3 && out[n - 3].x === out[n - 2].x) {
        out[n - 2].y = entryY;
        out[n - 1] = { x: bus.x, y: entryY };
        return out;
      }
      return [...out, { x: bus.x, y: entryY }];
    };
    const inLine = (source, points, extra = {}) => add({ id: `${node}:in:${source.id}`, from: source.id, to: node, flow: flowOf(source.id), cross: source.cross, scaffold: "in", railKey: `${railKey}:${source.id}`, rail: railKey, demand: source.cross || undefined, rel: source.cross ? [source.id, ...targetIds] : undefined, column: columnOf.get(source.id) || 0, ...extra }, points);
    for (const source of sources) if (!source.cross) inLine(source, bus.branchesIn.get(source.id));
    // Mehrere Abstiege aus derselben Spalte (#1591): ein gemeinsamer Strang statt eines Bündels - je Quelle ein Stamm
    // bis in die Gasse, dort hinunter (jedes Stück zeigt sich, sobald eine Quelle darüber gezeigt wird), dann ein Weg.
    const columns = new Map();
    for (const source of sources.filter((entry) => entry.cross)) {
      const key = Math.round(source.rect.right);
      if (!columns.has(key)) columns.set(key, []);
      columns.get(key).push(source);
    }
    for (const group of columns.values()) {
      const routes = new Map(group.map((source) => [source.id, intoEntry(bus.branchesIn.get(source.id))]));
      const template = routes.get(group[0].id);
      const gutter = template.length >= 4 && template[1].x === template[2].x && template[0].y === template[1].y ? template[1].x : null;
      if (group.length < 2 || gutter == null) {
        for (const source of group) inLine(source, routes.get(source.id));
        continue;
      }
      const turn = template[2].y;
      const ordered = [...group].sort((p, q) => Math.abs(routes.get(q.id)[0].y - turn) - Math.abs(routes.get(p.id)[0].y - turn));
      const stemY = (source) => routes.get(source.id)[0].y;
      const stems = ordered.map((source) => [{ x: source.rect.right, y: stemY(source) }, { x: gutter, y: stemY(source) }]);
      if (stems.some((points, index) => pathHits(points, obstacles.filter((rect) => rect !== ordered[index].rect)))) {
        for (const source of group) inLine(source, routes.get(source.id));
        continue;
      }
      ordered.forEach((source, index) => inLine(source, stems[index]));
      const relOf = (count) => [...ordered.slice(0, count).map((source) => source.id), ...targetIds];
      const railKeys = (count) => ordered.slice(0, count).map((source) => `${railKey}:${source.id}`);
      const base = { to: node, flow: "L", cross: true, scaffold: "in", rail: railKey, demand: true, column: columnOf.get(ordered[0].id) || 0 };
      for (let index = 0; index < ordered.length - 1; index += 1) {
        add({ ...base, id: `${node}:drop:${index}`, from: ordered[index].id, rel: relOf(index + 1), railKeys: railKeys(index + 1) },
          [{ x: gutter, y: stemY(ordered[index]) }, { x: gutter, y: stemY(ordered[index + 1]) }]);
      }
      const last = ordered[ordered.length - 1];
      add({ ...base, id: `${node}:drop:tail`, from: last.id, rel: relOf(ordered.length), railKeys: railKeys(ordered.length) },
        [{ x: gutter, y: stemY(last) }, ...template.slice(2)]);
    }
    for (const id of targetIds) add({ id: `${node}:out:${id}`, from: node, to: id, flow: "W", scaffold: "out", rail: railKey, column }, [{ x: bus.x, y: outY.get(id) }, { x: nodes.get(id).left, y: outY.get(id) }]);
  }
  const stubs = new Set();
  const plain = [];
  const shared = new Map();
  for (const edge of edges) {
    const a = nodes.get(edge.from);
    const b = nodes.get(edge.to);
    if (!a || !b) continue;
    const y = slotY(edge.to, edge.toSlot);
    const column = columnOf.get(edge.from) || 0;
    if (edge.rail && buses.has(edge.rail)) {
      // Der echte Weg eines Spielers nach der Auslosung: Ast aus der Quelle, die Schiene entlang, Ast in den Platz.
      add({ ...edge, demand: true, rel: [edge.from, edge.to], column }, buses.get(edge.rail).via(a, edge.cross, y ?? b.top + b.height / 2, b, edge.from));
      continue;
    }
    const drop = edge.flow === "L" && edge.cross;
    const pair = `${edge.from}>${edge.to}>${edge.flow}`;
    const known = !drop && !edge.void && y !== undefined ? shared.get(pair) : null;
    if (known && known.length >= 3 && known.at(-2).x === known.at(-3).x) {
      // Ein weiterer Platz aus demselben Spiel im selben Ziel: derselbe Weg, nur die letzte Zeile ist eine andere.
      const points = [...known.slice(0, -2), { x: known.at(-2).x, y }, { x: known.at(-1).x, y }];
      plain.push({ edge, points, a, b, column });
      continue;
    }
    const points = routeEdge({
      a, b, obstacles, lanes, gap, corridors,
      toY: y,
      // Der Abstieg beginnt an der Zeile „Die anderen …“ (sonst unten an der Karte) - nicht auf dem Knick des Siegers.
      fromY: drop ? (exitY(edge.from, "L") ?? a.bottom - 10) : exitY(edge.from, edge.flow),
      preferCorridor: drop,
    });
    if (drop) {
      add({ ...edge, demand: true, rel: [edge.from, edge.to], column }, points);
      const endY = points.at(-1).y;
      const key = `${edge.to}:${edge.toSlot ?? Math.round(endY)}`;
      if (!stubs.has(key)) {
        stubs.add(key);
        const entry = [{ x: b.left - STUB, y: endY }, { x: b.left, y: endY }];
        add({ id: `stub:${key}`, from: edge.from, to: edge.to, toSlot: edge.toSlot, flow: "L", cross: true, stub: true, marker: entry[0], rel: [edge.from, edge.to], column: columnOf.get(edge.to) || 0 }, entry);
      }
      continue;
    }
    if (!drop && !edge.void && y !== undefined) shared.set(pair, points);
    plain.push({ edge, points, a, b, column });
  }
  // Gabeln (#1591): laufen mehrere Linien durch dieselbe Gasse und überdecken sich dort (ein Spiel schickt mehrere Plätze
  // ins selbe Ziel, oder die Plätze zweier Spiele liegen im Ziel abwechselnd), steht der gemeinsame Teil nur einmal da:
  // je Quelle ein Stamm, ein Querstrich, je Platz ein Ast. Die Einzelwege kommen beim Zeigen.
  // Jeder Weg endet mit einer Senkrechten in der Gasse vor dem Ziel und dem Ast hinein: davor liegt sein Stamm.
  const simple = plain.map((entry) => {
    const { edge, points } = entry;
    const n = points.length;
    const ok = !edge.void && n >= 3 && points[n - 2].y === points[n - 1].y && points[n - 3].x === points[n - 2].x;
    if (!ok) return null;
    const stem = points.slice(0, n - 2);
    return { ...entry, stem, stemKey: JSON.stringify(stem), mid: points[n - 2].x, y1: Math.min(points[n - 3].y, points[n - 2].y), y2: Math.max(points[n - 3].y, points[n - 2].y) };
  });
  const parent = plain.map((_, index) => index);
  const find = (index) => (parent[index] === index ? index : (parent[index] = find(parent[index])));
  for (let i = 0; i < plain.length; i += 1) {
    for (let j = i + 1; j < plain.length; j += 1) {
      const p1 = simple[i];
      const p2 = simple[j];
      if (!p1 || !p2 || Math.abs(p1.mid - p2.mid) > 0.5) continue;
      const sameStem = p1.stemKey === p2.stemKey;
      const run = Math.min(p1.y2, p2.y2) - Math.max(p1.y1, p2.y1);
      if (sameStem || (run > 0.5 && p1.y2 > p1.y1 && p2.y2 > p2.y1)) parent[find(j)] = find(i);
    }
  }
  const clusters = new Map();
  plain.forEach((_, index) => {
    const root = find(index);
    if (!clusters.has(root)) clusters.set(root, []);
    clusters.get(root).push(index);
  });
  for (const indexes of clusters.values()) {
    if (indexes.length < 2) {
      const { edge, points, column } = plain[indexes[0]];
      add({ ...edge, column }, points);
      continue;
    }
    const members = indexes.map((index) => simple[index]);
    const mid = members[0].mid;
    const column = Math.min(...members.map((member) => member.column));
    const ids = members.map((member) => member.edge.id);
    const fork = `fork:${Math.round(mid)}:${Math.round(Math.min(...members.map((member) => member.y1)))}`;
    const base = { flow: members[0].edge.flow, fork: true, members: ids, column };
    const stems = new Map(members.map((member) => [member.stemKey, member]));
    let stemIndex = 0;
    for (const member of stems.values()) {
      if (member.stem.length > 1) add({ ...base, id: `${fork}:stem:${member.edge.from}:${stemIndex}`, from: member.edge.from, to: member.edge.to }, member.stem);
      stemIndex += 1;
    }
    const ys = members.flatMap((member) => [member.y1, member.y2]);
    add({ ...base, id: `${fork}:bar`, from: members[0].edge.from, to: members[0].edge.to }, [{ x: mid, y: Math.min(...ys) }, { x: mid, y: Math.max(...ys) }]);
    const ends = new Map(members.map((member) => [`${member.edge.to}:${member.points.at(-1).y}`, member]));
    for (const [key, member] of ends) add({ ...base, id: `${fork}:end:${key}`, from: member.edge.from, to: member.edge.to, toSlot: member.edge.toSlot }, [{ x: mid, y: member.points.at(-1).y }, member.points.at(-1)]);
    for (const member of members) add({ ...member.edge, demand: true, rel: [member.edge.from, member.edge.to], column: member.column }, member.points);
  }
  return lines;
}
