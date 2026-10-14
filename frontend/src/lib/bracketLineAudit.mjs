// Prüfung der Linien im Turnierbaum (#1591) - eine Regel für Vitest (gerechnete Fälle) und Playwright (echtes Layout,
// Web und TV). Ohne Abhängigkeiten, damit auch Node sie direkt laden kann. Geprüft wird nur, was sichtbar ist:
//   1. Jedes Ende hängt an einer Karte (an ihrem Rand), an einem Marker oder auf einer anderen Linie (Schiene, Gabel).
//   2. Keine zwei Strecken liegen auf derselben Achse übereinander (doppelt gezeichnet).
//   3. Keine zwei senkrechten Strecken verschiedener Linien laufen dicht nebeneinander (gedrängt).
//   4. Kein Punkt außerhalb der Leinwand, keine Strecke durch eine Karte.
//   5. Je Gruppe genau eine sichtbare Schiene.
// Punkte, Karten und Marker im selben Koordinatensystem (dem der Leinwand).

const TOLERANCE = 1.5;
const CROWD = 6;
const CROWD_MIN_RUN = 12;

/** „M10 20 L30 20 …“ → Punkte (wie lib/bracketLines.toPath sie schreibt). */
export function parsePath(d) {
  return (String(d || "").match(/[ML][^ML]+/g) || []).map((part) => {
    const [x, y] = part.slice(1).trim().split(/[\s,]+/).map(Number);
    return { x, y };
  });
}

const segmentsOf = (line) => {
  const result = [];
  for (let index = 0; index < line.points.length - 1; index += 1) {
    const p = line.points[index];
    const q = line.points[index + 1];
    if (Math.abs(p.x - q.x) < 0.01 && Math.abs(p.y - q.y) < 0.01) continue;
    result.push({ p, q, line, index });
  }
  return result;
};

const vertical = (segment) => Math.abs(segment.p.x - segment.q.x) < 0.5;
const horizontal = (segment) => Math.abs(segment.p.y - segment.q.y) < 0.5;

function onBorder(point, rect) {
  const inX = point.x >= rect.left - TOLERANCE && point.x <= rect.right + TOLERANCE;
  const inY = point.y >= rect.top - TOLERANCE && point.y <= rect.bottom + TOLERANCE;
  if (!inX || !inY) return false;
  return Math.abs(point.x - rect.left) <= TOLERANCE || Math.abs(point.x - rect.right) <= TOLERANCE
    || Math.abs(point.y - rect.top) <= TOLERANCE || Math.abs(point.y - rect.bottom) <= TOLERANCE;
}

function onSegment(point, segment) {
  const [x1, x2] = [Math.min(segment.p.x, segment.q.x), Math.max(segment.p.x, segment.q.x)];
  const [y1, y2] = [Math.min(segment.p.y, segment.q.y), Math.max(segment.p.y, segment.q.y)];
  if (vertical(segment)) return Math.abs(point.x - segment.p.x) <= TOLERANCE && point.y >= y1 - TOLERANCE && point.y <= y2 + TOLERANCE;
  if (horizontal(segment)) return Math.abs(point.y - segment.p.y) <= TOLERANCE && point.x >= x1 - TOLERANCE && point.x <= x2 + TOLERANCE;
  return false;
}

function throughRect(segment, rect) {
  const inset = 2;
  const left = rect.left + inset;
  const right = rect.right - inset;
  const top = rect.top + inset;
  const bottom = rect.bottom - inset;
  if (horizontal(segment)) {
    const [x1, x2] = [Math.min(segment.p.x, segment.q.x), Math.max(segment.p.x, segment.q.x)];
    return segment.p.y > top && segment.p.y < bottom && x2 > left && x1 < right;
  }
  const [y1, y2] = [Math.min(segment.p.y, segment.q.y), Math.max(segment.p.y, segment.q.y)];
  return segment.p.x > left && segment.p.x < right && y2 > top && y1 < bottom;
}

const overlap = (a1, a2, b1, b2) => Math.min(Math.max(a1, a2), Math.max(b1, b2)) - Math.max(Math.min(a1, a2), Math.min(b1, b2));

/**
 * Prüft die sichtbaren Linien. `lines`: `{ id, points, spine? }`; `boxes`: Karten (Rechtecke); `obstacles`: weitere
 * Flächen, die keine Linie kreuzen darf (Köpfe); `markers`: `{ x, y }`; `bounds`: `{ w, h }` der Leinwand.
 * `endpoints: false` lässt Regel 1 aus. Liefert die Befunde als Sätze (leer = in Ordnung).
 */
export function auditLines({ lines = [], boxes = [], obstacles = [], markers = [], bounds = null, endpoints = true }) {
  const problems = [];
  const segments = lines.flatMap(segmentsOf);
  for (const line of lines) {
    if (endpoints && line.points.length) {
      for (const point of [line.points[0], line.points[line.points.length - 1]]) {
        const attached = boxes.some((rect) => onBorder(point, rect))
          || markers.some((marker) => Math.abs(marker.x - point.x) <= TOLERANCE + 2 && Math.abs(marker.y - point.y) <= TOLERANCE + 2)
          || segments.some((segment) => segment.line !== line && onSegment(point, segment));
        if (!attached) problems.push(`${line.id}: Ende im Leeren bei ${Math.round(point.x)},${Math.round(point.y)}`);
      }
    }
    if (bounds && line.points.some((point) => point.x < -0.5 || point.y < -0.5 || point.x > bounds.w + 0.5 || point.y > bounds.h + 0.5)) {
      problems.push(`${line.id}: außerhalb der Leinwand`);
    }
  }
  for (const segment of segments) {
    for (const rect of [...boxes, ...obstacles]) {
      if (throughRect(segment, rect)) {
        problems.push(`${segment.line.id}: Strecke durch eine Karte bei ${Math.round(rect.left)},${Math.round(rect.top)}`);
        break;
      }
    }
  }
  for (let i = 0; i < segments.length; i += 1) {
    for (let j = i + 1; j < segments.length; j += 1) {
      const a = segments[i];
      const b = segments[j];
      if (a.line === b.line && Math.abs(a.index - b.index) <= 1) continue;
      if (vertical(a) && vertical(b)) {
        const run = overlap(a.p.y, a.q.y, b.p.y, b.q.y);
        const distance = Math.abs(a.p.x - b.p.x);
        if (distance < 0.5 && run > TOLERANCE) problems.push(`${a.line.id} und ${b.line.id}: senkrecht überlagert bei x ${Math.round(a.p.x)}`);
        else if (a.line !== b.line && distance >= 0.5 && distance < CROWD && run > CROWD_MIN_RUN) problems.push(`${a.line.id} und ${b.line.id}: gedrängt bei x ${Math.round(a.p.x)}`);
      } else if (horizontal(a) && horizontal(b)) {
        const run = overlap(a.p.x, a.q.x, b.p.x, b.q.x);
        if (Math.abs(a.p.y - b.p.y) < 0.5 && run > TOLERANCE) problems.push(`${a.line.id} und ${b.line.id}: waagrecht überlagert bei y ${Math.round(a.p.y)}`);
      }
    }
  }
  const spines = new Map();
  for (const line of lines) if (line.spine) spines.set(line.spine, (spines.get(line.spine) || 0) + 1);
  for (const [key, count] of spines) if (count !== 1) problems.push(`${key}: ${count} Schienen statt einer`);
  return problems;
}
