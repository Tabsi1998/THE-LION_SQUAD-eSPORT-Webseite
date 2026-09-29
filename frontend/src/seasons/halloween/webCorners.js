// Kleine Netze an echten Ecken (H12, #700): nicht irgendwo in der Fläche, sondern in den oberen Innenecken von
// Karten, Kacheln, Rahmen und der Fußzeile. Je Fenster höchstens eine Handvoll, mit Abstand, nie über Text,
// Bild oder Bedienelement (Sonde) und nie in Ruhezonen. Das große Netz in der Fensterecke bleibt der Blickfang;
// diese hier sind kleiner und blasser. Alles ohne React; die Anzeige liegt in CornerWebs.jsx.

import { hashString, mulberry32 } from "../rng";
import { measureQuietZones, pointInQuiet } from "../quiet";
import { blocksPoint } from "../glyphs";
import { EXTENT, HUB } from "./web";

export const BOX_SELECTOR = "[data-season-anchor='card'], [data-season-perch='card'], [data-season-perch='frame']";
export const FOOTER_SELECTOR = "footer";
export const MIN_DISTANCE = 320;
export const RADIUS = [22, 34];
export const OPACITY = [0.45, 0.68];
export const MAX_BOXES = 24;


const ids = new WeakMap();
let nextId = 1;

function elementId(element) {
  if (!ids.has(element)) ids.set(element, nextId++);
  return ids.get(element);
}

function scrollOf(win) {
  return { x: (win && win.scrollX) || 0, y: (win && win.scrollY) || 0 };
}

function rectOf(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  const rect = element.getBoundingClientRect();
  return rect && rect.width > 0 && rect.height > 0 ? rect : null;
}

/** Größe und Blässe eines Netzes aus seinem Seed - jedes anders, keines so groß wie das in der Fensterecke. */
export function webSpec(seed) {
  const rng = mulberry32(hashString(`cweb:${seed}`));
  const radius = Math.round(RADIUS[0] + rng() * (RADIUS[1] - RADIUS[0]));
  const opacity = Math.round((OPACITY[0] + rng() * (OPACITY[1] - OPACITY[0])) * 100) / 100;
  return { seed, radius, opacity, width: Math.round(EXTENT.x * radius), height: Math.round(EXTENT.y * radius) };
}

/** Wo die Nabe eines Netzes liegt (innerhalb seines Kastens), je Ecke gespiegelt. */
export function hubOf(spec, side) {
  const x = HUB.x * spec.radius;
  return { x: side === "tr" ? spec.width - x : x, y: HUB.y * spec.radius };
}

/**
 * Ist die Fläche des Netzes frei? Die Sonde (`elementFromPoint`) prüft sechs Punkte im Netzkasten: zwischen Treffer
 * und Element darf kein Bild, keine Grafik und kein Bedienelement liegen, und keine Schrift - Schrift zählt nur mit
 * ihren Zeichenkästen (`glyphs.js`), nicht mit dem oft kartenbreiten Kasten ihres Behälters. Das Element selbst und
 * nackte Behälter sind frei.
 */
function areaFree(probe, owner, points) {
  if (!probe) return true;
  return points.every(([x, y]) => {
    const hit = probe(x, y);
    if (!hit || hit === owner) return true;
    if (!owner.contains(hit)) return false;
    let node = hit;
    while (node && node !== owner) {
      if (blocksPoint(node, x, y)) return false;
      node = node.parentElement;
    }
    return true;
  });
}

function cornerCandidate({ kind, element, side, rect, win, probe, spec }) {
  const scroll = scrollOf(win);
  const x = side === "tl" ? rect.left + 1 : rect.right - 1;
  const y = rect.top + 1;
  const dir = side === "tl" ? 1 : -1;
  // Sechs Punkte im Netzkasten - die Ecke selbst ist meist frei, die Ränder des Kastens nicht immer.
  const points = [[0.25, 0.3], [0.75, 0.3], [0.5, 0.5], [0.25, 0.65], [0.75, 0.65], [0.9, 0.9]].map(([fx, fy]) => [x + dir * spec.width * fx, y + spec.height * fy]);
  if (!areaFree(probe, element, points)) return null;
  const measure = () => {
    if (!element.isConnected) return null;
    const again = rectOf(element);
    if (!again) return null;
    const now = scrollOf(win);
    return { x: (side === "tl" ? again.left + 1 : again.right - 1) + now.x, y: again.top + 1 + now.y };
  };
  return { kind, side, element, x: x + scroll.x, y: y + scroll.y, spec, measure, key: `${kind}:${elementId(element)}:${side}` };
}

/**
 * Ecken im Fenster (plus Rand), die ein Netz tragen können. `taken` sind belegte Schlüssel; `probe` ersetzt
 * `elementFromPoint` (Tests); `seed` macht Größe und Blässe je Ecke stabil.
 */
export function measureWebCorners(doc = document, win = typeof window === "undefined" ? null : window, { zones = measureQuietZones(doc, win), taken = new Set(), probe = typeof doc.elementFromPoint === "function" ? (x, y) => doc.elementFromPoint(x, y) : null, seed = 0.5, margin = 60 } = {}) {
  const height = (win && win.innerHeight) || 800;
  const out = [];
  const consider = (kind, element, index) => {
    const rect = rectOf(element);
    if (!rect || rect.width < 160 || rect.height < 90) return;
    if (rect.top > height + margin || rect.bottom < -margin) return;
    ["tl", "tr"].forEach((side) => {
      const spec = webSpec(`${seed}:${index}:${side}`);
      const candidate = cornerCandidate({ kind, element, side, rect, win, probe, spec });
      if (candidate && !taken.has(candidate.key)) out.push(candidate);
    });
  };
  Array.from(doc.querySelectorAll(BOX_SELECTOR)).slice(0, MAX_BOXES).forEach((element, index) => consider("box", element, index));
  const footer = doc.querySelector(FOOTER_SELECTOR);
  if (footer) consider("footer", footer, "footer");
  return out.filter((corner) => !pointInQuiet({ x: corner.x, y: corner.y }, zones, { fixed: false }));
}

/** Auswahl: nie zwei am selben Element, nie näher als der Mindestabstand (auch zu `taken`); die Fußzeile kommt etwas lieber dran. */
export function chooseWebCorners(candidates, count, rng, taken = []) {
  const chosen = [];
  const usedElements = new Set(taken.map((web) => web.element).filter(Boolean));
  const farEnough = (candidate) => [...taken, ...chosen].every((other) => Math.hypot(other.x - candidate.x, other.y - candidate.y) >= MIN_DISTANCE);
  for (let n = 0; n < count; n += 1) {
    const options = candidates.filter((candidate) => !usedElements.has(candidate.element) && farEnough(candidate));
    if (!options.length) break;
    const weighted = options.map((candidate) => ({ candidate, weight: candidate.kind === "footer" ? 1.6 : 1 }));
    let roll = rng() * weighted.reduce((sum, entry) => sum + entry.weight, 0);
    let pick = weighted[weighted.length - 1].candidate;
    for (let i = 0; i < weighted.length; i += 1) {
      roll -= weighted[i].weight;
      if (roll <= 0) {
        pick = weighted[i].candidate;
        break;
      }
    }
    chosen.push(pick);
    usedElements.add(pick.element);
  }
  return chosen;
}
