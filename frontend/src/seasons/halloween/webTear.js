// Netz reißt (Jahreszeiten IV, #1089): Hebt sich eine Karte mit einem Eck-Netz (Karten-Signal, ../cardLift.js), reißen
// die Fäden nacheinander in gut einer halben Sekunde (erst die Anker, dann der Rahmen), ein Fetzen weht zwei Sekunden
// davon, der Rest löst sich auf; die Spinne seilt sich ab. Nach etwa einer Minute baut sie in Ruhe neu - Faden für
// Faden in der Reihenfolge, in der sie ein Netz spinnt. Drei sichtbare Vorgänge, keine Standbilder. Nur an dieser Karte;
// höchstens einmal je Minute je Karte. Reine Rechnung; die Anzeige liegt in CornerWebs.jsx (Animationen in
// halloween.css). Die App rechnet dasselbe (mobile/src/seasons/webTear.ts).

import { hashString, mulberry32 } from "../rng";

export const TEAR = {
  /** So lange reißen die Fäden nacheinander (ms). */
  snapMs: 650,
  /** So lange reißt ein einzelner Faden (ms). */
  snapEachMs: 240,
  /** So lange weht der Fetzen davon (ms), ab wann (ms). */
  scrapMs: 2000,
  scrapAt: 420,
  /** So lange löst sich der Rest auf (ms), ab wann (ms). */
  dissolveMs: 900,
  dissolveAt: 520,
  /** So lange seilt sich die Spinne ab (ms). */
  rappelMs: 1400,
  /** Danach ist das Netz weg (ms) - bis zum Neubau. */
  goneAt: 2600,
  /** Neubau nach (ms) und wie lange er dauert (ms). */
  rebuildAt: 60000,
  buildMs: 5200,
  /** Wie weit der Fetzen fliegt (px) und wie stark er sich dreht (Grad). */
  scrapDx: [28, 62],
  scrapDy: [70, 120],
  scrapTurn: [22, 46],
};

const round = (value) => Math.round(value * 10) / 10;
const between = (rng, [lo, hi]) => lo + rng() * (hi - lo);

export function lineLength(line) {
  return round(Math.hypot(line.x2 - line.x1, line.y2 - line.y1));
}

/**
 * Wie ein Netz reißt: je Faden `snap` (reißt, mit Verzögerung), `scrap` (gehört zum Fetzen) oder `fade` (löst sich
 * auf). Anker reißen zuerst, dann der Rahmen; der Fetzen ist die äußere Hälfte auf der Seite weg von der Ecke. Dazu
 * Flug und Drehung des Fetzens. `side` ist die Ecke (tl/tr), `hub` die Nabe im Kasten.
 */
export function tearPlan(lines, { seed = "web", side = "tl", hub = { x: 0, y: 0 } } = {}) {
  const rng = mulberry32(hashString(`webtear:${seed}`));
  const away = side === "tr" ? -1 : 1;
  const anchors = [];
  const frames = [];
  const plan = lines.map((line, index) => {
    const mx = (line.x1 + line.x2) / 2;
    const my = (line.y1 + line.y2) / 2;
    // Weg von der Ecke: rechts-unten der Nabe (tl) bzw. links-unten (tr).
    const outward = (mx - hub.x) * away + (my - hub.y) * 0.6;
    let role = "fade";
    if (line.kind === "anchor") role = "snap";
    else if (line.kind === "frame") role = outward > 0 ? "scrap" : "snap";
    else if (outward > hub.x * 0.15) role = "scrap";
    const entry = { index, role, length: lineLength(line), delay: 0 };
    if (line.kind === "anchor") anchors.push(entry);
    else if (role === "snap") frames.push(entry);
    return entry;
  });
  const snaps = [...anchors, ...frames];
  const spread = Math.max(0, TEAR.snapMs - TEAR.snapEachMs);
  snaps.forEach((entry, n) => {
    entry.delay = Math.round(snaps.length > 1 ? (n / (snaps.length - 1)) * spread : 0);
  });
  const scrap = {
    dx: Math.round(between(rng, TEAR.scrapDx) * away),
    dy: Math.round(between(rng, TEAR.scrapDy)),
    turn: Math.round(between(rng, TEAR.scrapTurn) * (rng() < 0.5 ? -1 : 1)),
  };
  return { lines: plan, scrap };
}

/**
 * Der Neubau: Faden für Faden in der Reihenfolge des Plans (so spinnt die Spinne: Anker, Rahmen, Speichen, Spirale),
 * gleichmäßig über `TEAR.buildMs` verteilt. Liefert die Verzögerung je Faden (ms).
 */
export function buildDelays(count, buildMs = TEAR.buildMs) {
  if (count <= 0) return [];
  const step = buildMs / count;
  return Array.from({ length: count }, (_, index) => Math.round(index * step));
}

/** In welcher Phase das Netz `elapsedMs` nach dem Reißen ist: tear, gone, build, done. */
export function tearPhase(elapsedMs) {
  const t = Math.max(0, Number(elapsedMs) || 0);
  if (t < TEAR.goneAt) return "tear";
  if (t < TEAR.rebuildAt) return "gone";
  if (t < TEAR.rebuildAt + TEAR.buildMs + 400) return "build";
  return "done";
}
