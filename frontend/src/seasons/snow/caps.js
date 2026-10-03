// Schneehauben (S7, #638; W3, #729): Schnee sammelt sich auf echten Oberkanten - Karten, Rahmen, Fußzeile - nicht
// als Randmaske überall gleich, sondern je Kante anders: eigene Kontur aus dem Jahres-Seed, eigenes Wachstum, nur
// dort, wo darunter nichts liegt (keine Abzeichen, Knöpfe, Schrift). Die Stufe kommt vom Server (1 bis 10.12., 2
// bis 24.12., dann 3); bei Plusgraden taut es langsam. Keine Layoutverschiebung: die Haube liegt über der Kante.
// Reine Rechnung; die Anzeige liegt in SnowCaps.jsx.

import { hashString, mulberry32 } from "../rng";
import { cornerSlot, freeSlots, measureAnchors, probeOf } from "../anchors";
import { measureQuietZones } from "../quiet";
import { ownTextNodes, pointOnText } from "../glyphs";

/** Was eine Kante sperrt: Bedienelemente, Symbole und Abzeichen - Bilder nicht (Schnee liegt auch auf einem Titelbild). */
export const EDGE_BLOCKERS = "button, input, select, textarea, label, [role='button'], [role='img'], svg, time, [data-badge], .badge";

function edgeBlocked(node, x, y) {
  if (!node || node.nodeType !== 1 || typeof node.matches !== "function") return false;
  if (node.matches(EDGE_BLOCKERS)) return true;
  return ownTextNodes(node).length ? pointOnText(node, x, y) : false;
}

/**
 * Ist die Kante an diesen Punkten frei? Die Sonde liefert das oberste Element: außerhalb der Karte sperrt es immer
 * (etwas liegt über der Kante), innerhalb nur Bedienung, Symbole, Abzeichen und Schrift; Bilder und nackte Behälter nicht.
 */
export function edgeFree(probe, owner, points) {
  if (!probe) return true;
  return points.every(([x, y]) => {
    const hit = probe(x, y);
    if (!hit || hit === owner) return true;
    if (!owner.contains(hit)) return false;
    let node = hit;
    while (node && node !== owner) {
      if (edgeBlocked(node, x, y)) return false;
      node = node.parentElement;
    }
    return true;
  });
}

/** Dicke je Stufe (px) und wie weit die Haube über die Kante nach unten hängt. */
export const THICKNESS = { 1: 4, 2: 6.5, 3: 9 };
export const OVERHANG = 1.6;
/** Ein Stück der Kante, das einzeln frei sein muss; kürzere Reste fallen weg. */
export const SEGMENT = 48;
export const MIN_RUN = 40;
/** Einzug an den Kanten-Enden (Ecken sind meist gerundet). */
export const INSET = 6;
export const MAX_CAPS = 24;

/** Die wirksame Stufe: Plusgrade tauen - über 3 °C eine Stufe weniger, über 0,5 °C eine halbe; nie unter 0,5. */
export function capLevel({ stage = 1, tempC = null } = {}) {
  const base = Math.max(1, Math.min(3, Number(stage) || 1));
  const temp = Number(tempC);
  if (!Number.isFinite(temp)) return base;
  if (temp > 3) return Math.max(0.5, base - 1);
  if (temp > 0.5) return Math.max(0.5, base - 0.5);
  return base;
}

/** Dicke aus Stufe (auch halbe) und dem eigenen Wachstum der Kante. */
export function capThickness(level, growth = 1) {
  if (level < 1) return Math.round(THICKNESS[1] * Math.max(0, level) * growth * 10) / 10;
  const lo = Math.floor(level);
  const hi = Math.ceil(level);
  const a = THICKNESS[Math.max(1, lo)] || THICKNESS[1];
  const b = THICKNESS[Math.min(3, hi)] || THICKNESS[3];
  const t = level - lo;
  return Math.round((a + (b - a) * t) * growth * 10) / 10;
}

/**
 * Die Kontur einer Haube als SVG-Pfad in eigenen Koordinaten: x von 0 bis `width`, die Kante bei y = `thickness`,
 * der Schnee darüber (y kleiner) mit weichen Buckeln aus dem Seed, an den Enden auslaufend, unten mit leichtem
 * Überhang; ab Stufe 2 hängen ein, zwei kleine Zapfen herunter.
 */
export function capPath({ width, thickness, seed = "cap", level = 1, dents = [] }) {
  const rng = mulberry32(hashString(`snowcap:${seed}`));
  const w = Math.max(8, width);
  const t = Math.max(1, thickness);
  const base = t + OVERHANG;
  const step = 16 + rng() * 14;
  const points = [];
  for (let x = 0; x <= w; x += step) {
    const edge = Math.min(1, Math.min(x, w - x) / (w * 0.18 + 1));
    const height = t * (0.55 + rng() * 0.45) * edge;
    points.push({ x: Math.min(w, x), y: base - height });
  }
  if (points[points.length - 1].x < w) points.push({ x: w, y: base - 0.2 });
  points[0].y = base - 0.2;
  // Dellen einer Spur (W5 #731, tracks.js): die Schneelinie sinkt an jedem Schritt weich ein - die Zufallsfolge oben
  // bleibt dieselbe, die Haube sieht ohne Spur genauso aus wie vorher.
  const live = dents.filter((dent) => dent.depth > 0.05 && dent.x > 0 && dent.x < w);
  if (live.length) {
    const topAt = (x) => {
      const i = Math.max(0, points.findIndex((point, n) => n + 1 < points.length && point.x <= x && points[n + 1].x >= x));
      const a = points[i];
      const b = points[Math.min(points.length - 1, i + 1)];
      return b.x === a.x ? a.y : a.y + ((x - a.x) / (b.x - a.x)) * (b.y - a.y);
    };
    const extra = [];
    live.forEach((dent) => {
      const half = dent.width / 2;
      [[-half, 0], [-half / 2, 0.75], [0, 1], [half / 2, 0.75], [half, 0]].forEach(([dx, share]) => {
        const x = dent.x + dx;
        // Höchstens zwei Drittel der Schneehöhe an dieser Stelle: unter dem Schritt bleibt immer etwas Schnee.
        const top = topAt(x);
        if (x > 0 && x < w) extra.push({ x, y: Math.min(base - 0.4, top + Math.min(dent.depth, (base - top) * 0.66) * share) });
      });
    });
    const kept = points.filter((point, n) => n === 0 || n === points.length - 1 || !live.some((dent) => Math.abs(point.x - dent.x) < dent.width / 2));
    points.splice(0, points.length, ...[...kept, ...extra].sort((a, b) => a.x - b.x));
  }
  let d = `M 0 ${base.toFixed(1)} L ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;
  for (let i = 1; i < points.length; i += 1) {
    const prev = points[i - 1];
    const next = points[i];
    const cx = (prev.x + next.x) / 2;
    d += ` Q ${((prev.x + cx) / 2).toFixed(1)} ${prev.y.toFixed(1)} ${cx.toFixed(1)} ${((prev.y + next.y) / 2).toFixed(1)}`;
    d += ` Q ${((cx + next.x) / 2).toFixed(1)} ${next.y.toFixed(1)} ${next.x.toFixed(1)} ${next.y.toFixed(1)}`;
  }
  d += ` L ${w.toFixed(1)} ${base.toFixed(1)}`;
  // Unterkante mit Überhang und Zapfen (ab Stufe 2): von rechts nach links zurück.
  const drips = level >= 2 ? 1 + Math.floor(rng() * 2) : 0;
  const dripAt = Array.from({ length: drips }, () => w * (0.15 + rng() * 0.7)).sort((a, b) => b - a);
  let x = w;
  dripAt.forEach((dx) => {
    const len = 2.5 + rng() * (level >= 3 ? 5 : 3);
    d += ` L ${(dx + 2.2).toFixed(1)} ${(base + 0.3).toFixed(1)} Q ${(dx + 0.9).toFixed(1)} ${(base + len * 0.55).toFixed(1)} ${dx.toFixed(1)} ${(base + len).toFixed(1)} Q ${(dx - 0.9).toFixed(1)} ${(base + len * 0.55).toFixed(1)} ${(dx - 2.2).toFixed(1)} ${(base + 0.3).toFixed(1)}`;
    x = dx - 2;
  });
  void x;
  d += ` L 0 ${(base + 0.3).toFixed(1)} Z`;
  return { d, height: base + (drips ? 8.5 : 0.5), base };
}

/** Freie Stücke der Oberkante: Abschnitte, unter denen nichts liegt (Sonde), zu Läufen zusammengefasst. */
export function freeRuns(anchor, { probe, win, inset = INSET, segment = SEGMENT, minRun = MIN_RUN }) {
  const { rect, element } = anchor;
  const from = rect.left + inset;
  const to = rect.right - inset;
  if (to - from < minRun) return [];
  const count = Math.max(1, Math.round((to - from) / segment));
  const width = (to - from) / count;
  const runs = [];
  let current = null;
  for (let i = 0; i < count; i += 1) {
    const x0 = from + i * width;
    const x1 = x0 + width;
    const mid = (x0 + x1) / 2;
    const free = !win || (rect.top >= -10 && rect.top <= win.innerHeight + 10)
      ? edgeFree(probe, element, [[mid, rect.top + 3], [mid, rect.top + 8], [x0 + 4, rect.top + 4], [x1 - 4, rect.top + 4]])
      : true;
    if (free) {
      if (current) current.to = x1;
      else current = { from: x0, to: x1 };
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs.filter((run) => run.to - run.from >= minRun).map((run) => ({ from: run.from - rect.left, to: run.to - rect.left }));
}

/**
 * Alle Kanten im Fenster (plus Rand), die eine Haube tragen können, mit ihren freien Läufen; `salt` macht Kontur und
 * Wachstum je Kante und Jahr stabil. Ruhezonen bleiben frei. Höchstens `max`, in Seitenreihenfolge.
 */
export function measureCaps(doc = document, win = typeof window === "undefined" ? null : window, { zones = measureQuietZones(doc, win), probe = probeOf(doc), salt = "", max = MAX_CAPS, margin = 120 } = {}) {
  const anchors = measureAnchors(doc, win, { kinds: ["card", "frame", "footer"], minSize: { card: [90, 40], frame: [90, 40], footer: [200, 60] }, limits: { card: 40, frame: 40 }, inViewMargin: margin });
  const caps = anchors.map((anchor) => {
    const runs = freeRuns(anchor, { probe, win });
    if (!runs.length) return null;
    const corner = cornerSlot(anchor, { side: "tl", width: 1, height: 1, probe: null, win });
    if (!corner) return null;
    const rng = mulberry32(hashString(`snowcap:${salt}:${anchor.key}`));
    return { ...corner, key: `cap:${anchor.key}`, kind: anchor.kind, width: anchor.rect.width, runs, growth: Math.round((0.7 + rng() * 0.6) * 100) / 100, seed: `${salt}:${anchor.key}`, measure: () => {
      const point = corner.measure();
      return point ? { x: point.x - 1, y: point.y - 1 } : null;
    }, x: corner.x - 1, y: corner.y - 1, px: corner.px - 1, py: corner.py - 1 };
  });
  // Geöffnete Dialoge und Menüs nehmen beim Messen nichts weg - darunter weicht die Haube aus (SnowCaps.jsx, Ausblenden).
  return freeSlots(caps, { zones: (zones || []).filter((zone) => !zone.overlay) }).slice(0, max);
}
