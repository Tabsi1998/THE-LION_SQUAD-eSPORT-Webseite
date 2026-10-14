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
