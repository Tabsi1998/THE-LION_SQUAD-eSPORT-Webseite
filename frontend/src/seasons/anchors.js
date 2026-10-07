// Saison-Anker (Seasonal Core C1, #721): die Idee der Halloween-Plätze (H7, #695) und Ecknetze (H12, #700) als
// gemeinsamer Kern für jede Jahreszeit. Ein Anker ist eine echte Kante oder Ecke eines Elements der Seite:
// Menüpunkt, Kopfzeile, Karte, Rahmen, freistehendes Bild, Held (der Löwe), Fußzeile und ihr Strich. Aus Ankern
// werden Plätze - Punkte auf einer Kante (sitzend auf der Ober-, hängend unter der Unterkante) oder Ecken mit
// einem Kasten. Eine Saison bringt nur ihren Plan mit (welche Kanten, welche Bruchteile, welche Größe); Messen,
// Sonde, Ruhezonen, Nachbarn, Belegung und Auswahl liegen hier. Alles ohne React. Die App hat denselben Kern in
// mobile/src/seasons/anchors.tsx + perches.ts (Karten melden sich selbst, weil es dort kein elementFromPoint gibt).

import { pointInQuiet } from "./quiet";
import { blocksPoint } from "./glyphs";
import { hashString } from "./rng";

/** Die Ankerarten der Seite. Eigene Kennzeichnung: data-season-anchor, data-season-perch, data-season-line. */
export const ANCHOR_SELECTORS = {
  nav: "header nav a",
  header: "header",
  card: "[data-season-anchor='card'], [data-season-perch='card']",
  frame: "[data-season-perch='frame']",
  image: "main img, main picture, main video",
  hero: "[data-season-anchor='lion'], [data-season-anchor='hero']",
  footer: "footer",
  footerLine: "footer [data-season-line]",
};
export const ANCHOR_KINDS = Object.keys(ANCHOR_SELECTORS);
/** Kleinere Elemente tragen nichts: [Breite, Höhe]. */
export const MIN_SIZE = { nav: [24, 10], header: [0, 30], card: [120, 60], frame: [120, 60], image: [160, 100], hero: [80, 80], footer: [160, 90], footerLine: [300, 0] };
/** Höchstens so viele Elemente je Art werden gemessen (lange Listen). */
export const MAX_PER_KIND = { card: 16, frame: 16, image: 6 };
/** Nur was oben klebt, ist ein Kopfzeilen-Anker: das Menü bis 160 px, die Kopfzeile bis 40 px vom oberen Rand. */
export const TOP_LIMIT = { nav: 160, header: 40 };
/** Sitzt (Oberkante, Ecke) oder hängt (Unterkante)? */
export const POSE = { hang: "hang", sit: "sit" };
/** Schrift und Bedienung, die einen Kantenplatz sperren (Behälter zählt ganz - Kanten liegen dicht an Zeilen). */
export const TEXT_LIKE = "p, h1, h2, h3, h4, h5, h6, li, a, button, time, label, input, select, textarea, span, strong, em, small, td, th, figcaption, blockquote, pre, code";
const BLOCKING = `${ANCHOR_SELECTORS.card}, ${ANCHOR_SELECTORS.frame}, ${TEXT_LIKE}`;
/** Sechs Punkte im Eckkasten - die Ecke selbst ist meist frei, die Ränder des Kastens nicht immer. */
export const CORNER_PROBE_POINTS = [[0.25, 0.3], [0.75, 0.3], [0.5, 0.5], [0.25, 0.65], [0.75, 0.65], [0.9, 0.9]];

const elementIds = new WeakMap();
let nextElementId = 1;

/** Ein je Element stabiler Schlüssel: Karten teilen sich Klassen, Belegung braucht aber das einzelne Element. */
export function elementId(element) {
  if (!elementIds.has(element)) elementIds.set(element, nextElementId++);
  return elementIds.get(element);
}

export function scrollOf(win) {
  return { x: (win && win.scrollX) || 0, y: (win && win.scrollY) || 0 };
}

export function rectOf(element) {
  if (!element || typeof element.getBoundingClientRect !== "function") return null;
  const rect = element.getBoundingClientRect();
  if (!rect || rect.width <= 0 || rect.height <= 0) return null;
  // Eine gehobene Karte (#1071, #1087) wird an ihrem Ruheplatz gemessen: die Deko fährt beim Anheben per CSS mit
  // (data-season-lifted) - sonst säße sie nach einem Nachmessen während des Anhebens doppelt so hoch.
  const lift = liftOf(element);
  return lift ? { left: rect.left, right: rect.right, width: rect.width, height: rect.height, x: rect.x, y: rect.y - lift, top: rect.top - lift, bottom: rect.bottom - lift } : rect;
}

/** Wie weit eine Karte gerade gehoben ist (px, negativ = nach oben) - nur reine Verschiebungen von .tls-card. */
export function liftOf(element) {
  if (!element || !element.classList || !element.classList.contains("tls-card")) return 0;
  const view = element.ownerDocument && element.ownerDocument.defaultView;
  if (!view || typeof view.getComputedStyle !== "function") return 0;
  const match = /^matrix\(1, 0, 0, 1, [-\d.e]+, ([-\d.e]+)\)$/.exec(view.getComputedStyle(element).transform || "");
  const dy = match ? Number(match[1]) : 0;
  return Number.isFinite(dy) && dy < 0 ? dy : 0;
}

function isSticky(element, win) {
  if (!element || !win || typeof win.getComputedStyle !== "function") return false;
  const position = win.getComputedStyle(element).position;
  return position === "fixed" || position === "sticky";
}

/** Die Sonde der Seite: `elementFromPoint`, in Tests gestellt oder null (dann entscheidet nur die Geometrie). */
export function probeOf(doc) {
  return doc && typeof doc.elementFromPoint === "function" ? (x, y) => doc.elementFromPoint(x, y) : null;
}

/**
 * Alle Anker der Seite: je Element Art, Fensterrechteck, Seitenrechteck, ob es am Fenster klebt (Kopfzeile, Menü)
 * und ein stabiler Schlüssel. `kinds` wählt Arten, `selectors`/`minSize`/`limits` überschreiben je Art (eine Saison
 * darf Karten und Rahmen als eine Art „box“ messen), `inViewMargin` lässt nur Anker im Fenster (plus Rand) durch.
 */
export function measureAnchors(doc = document, win = typeof window === "undefined" ? null : window, { kinds = ANCHOR_KINDS, selectors = {}, minSize = {}, limits = {}, inViewMargin = null } = {}) {
  const scroll = scrollOf(win);
  const height = (win && win.innerHeight) || 800;
  const out = [];
  kinds.forEach((kind) => {
    const selector = selectors[kind] || ANCHOR_SELECTORS[kind];
    if (!selector) return;
    let elements = Array.from(doc.querySelectorAll(selector));
    if (kind === "image") elements = elements.filter((element) => !element.closest(`${ANCHOR_SELECTORS.card}, ${ANCHOR_SELECTORS.frame}, header, footer`));
    if (kind === "header" || kind === "footer" || kind === "footerLine") elements = elements.slice(0, 1);
    const limit = limits[kind] ?? MAX_PER_KIND[kind];
    if (limit) elements = elements.slice(0, limit);
    const [minWidth, minHeight] = minSize[kind] || MIN_SIZE[kind] || [0, 0];
    elements.forEach((element, index) => {
      const rect = rectOf(element);
      if (!rect || rect.width < minWidth || rect.height < minHeight) return;
      if (TOP_LIMIT[kind] !== undefined && rect.top > TOP_LIMIT[kind]) return;
      if (inViewMargin !== null && (rect.top > height + inViewMargin || rect.bottom < -inViewMargin)) return;
      const sticky = kind === "nav" ? isSticky(element.closest("header") || element, win) : kind === "header" ? isSticky(element, win) : false;
      out.push({ kind, element, index, fixed: sticky, rect, page: { left: rect.left + scroll.x, right: rect.right + scroll.x, top: rect.top + scroll.y, bottom: rect.bottom + scroll.y }, key: `${kind}:${elementId(element)}` });
    });
  });
  return out;
}

/** Die Seitenrechtecke aller Anker-Elemente (unbegrenzt): kein Platz darf eine Nachbarkarte oder ein Bild schneiden. */
export function neighbourRects(doc = document, win = typeof window === "undefined" ? null : window, selector = `${ANCHOR_SELECTORS.card}, ${ANCHOR_SELECTORS.frame}, ${ANCHOR_SELECTORS.image}`) {
  const scroll = scrollOf(win);
  return Array.from(doc.querySelectorAll(selector)).map((element) => {
    const rect = rectOf(element);
    return rect ? { element, page: { left: rect.left + scroll.x, right: rect.right + scroll.x, top: rect.top + scroll.y, bottom: rect.bottom + scroll.y } } : null;
  }).filter(Boolean);
}

/**
 * Ist an einem Fensterpunkt Platz für eine Figur? Außerhalb des Fensters weiß niemand etwas - dann gilt der Punkt
 * als frei, die Geometrie der anderen Karten prüft `clearOf`. Text, Bedienelemente und andere Karten sperren; das
 * eigene Element, dessen Rahmen und nackter Hintergrund nicht.
 */
export function roomAt(probe, x, y, owner, win, blocking = BLOCKING) {
  if (!probe) return true;
  if (win && (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight)) return true;
  const hit = probe(x, y);
  if (!hit || hit === owner) return true;
  if (typeof hit.closest !== "function") return true;
  const blocker = hit.closest(blocking);
  if (!blocker) return true;
  return blocker === owner || (owner.contains(blocker) && !blocker.matches(TEXT_LIKE) && !blocker.closest(TEXT_LIKE));
}

/**
 * Ist eine Fläche frei? Die Sonde prüft jeden Punkt: zwischen Treffer und Element darf kein Bild, keine Grafik und
 * kein Bedienelement liegen, und keine Schrift - Schrift zählt nur mit ihren Zeichenkästen (glyphs.js), nicht mit
 * dem oft kartenbreiten Kasten ihres Behälters. Das Element selbst und nackte Behälter sind frei; alles außerhalb
 * des Elements sperrt.
 */
export function areaFree(probe, owner, points) {
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

/** Schneidet die Figur an (x, y) eines der anderen Anker-Elemente (Seitenkoordinaten)? */
export function clearOf(rects, owner, x, top, width, height) {
  const left = x - width / 2;
  const right = x + width / 2;
  const bottom = top + height;
  return rects.every(({ element, page }) => element === owner || right <= page.left || left >= page.right || bottom <= page.top || top >= page.bottom);
}

/**
 * Ein Platz an einem Anker: `at(rect)` rechnet den Punkt aus dem frischen Fensterrechteck. Klebt der Anker am
 * Fenster, bleiben x/y Fensterkoordinaten, sonst werden sie um den Scrollstand zu Seitenkoordinaten; `px`/`py`
 * sind immer Seitenkoordinaten (für Abstände und Ruhezonen). `measure()` misst später nach - null, wenn das
 * Element weg ist. `kind` darf die Art umbenennen (der Held heißt bei Halloween „lion“).
 */
export function makeSlot(anchor, { at, pose = POSE.sit, size = 22, index = 0, kind = anchor.kind, fixed = anchor.fixed, win = null }) {
  const { element } = anchor;
  const rect = rectOf(element);
  if (!rect) return null;
  const first = at(rect);
  if (!first) return null;
  const scroll = scrollOf(win);
  const measure = () => {
    if (!element.isConnected) return null;
    const again = rectOf(element);
    if (!again) return null;
    const point = at(again);
    if (!point) return null;
    const now = scrollOf(win);
    return fixed ? { x: point.x, y: point.y } : { x: point.x + now.x, y: point.y + now.y };
  };
  const x = fixed ? first.x : first.x + scroll.x;
  const y = fixed ? first.y : first.y + scroll.y;
  return { kind, pose, fixed, element, index, x, y, px: first.x + scroll.x, py: first.y + scroll.y, size, measure, key: `${kind}:${elementId(element)}:${index}` };
}

/**
 * Ein Platz auf einer Kante: `edge` top/bottom, die Stelle als Bruchteil der Breite (`fraction`) oder als Abstand
 * vom linken (positiv) bzw. rechten (negativ) Rand in px (`inset`), `dy` schiebt vom Rand weg (hängend 1–2 px
 * darunter). Schrumpft das Element später unter `minWidth`, ist der Platz weg.
 */
export function edgeSlot(anchor, { edge = "top", fraction = 0.5, inset = null, dy = 0, minWidth = 0, pose = edge === "top" ? POSE.sit : POSE.hang, ...rest }) {
  return makeSlot(anchor, {
    ...rest,
    pose,
    at: (r) => (r.width < minWidth ? null : { x: inset === null ? r.left + r.width * fraction : inset >= 0 ? r.left + inset : r.right + inset, y: (edge === "top" ? r.top : r.bottom) + dy }),
  });
}

/** Ein Platz an einem Punkt im Element (Bruchteile der Breite und Höhe) - etwa in der Mähne des Löwen. */
export function pointSlot(anchor, { fx = 0.5, fy = 0.5, minWidth = 0, pose = POSE.hang, ...rest }) {
  return makeSlot(anchor, { ...rest, pose, at: (r) => (r.width < minWidth ? null : { x: r.left + r.width * fx, y: r.top + r.height * fy }) });
}

/**
 * Eine Ecke mit Kasten (Breite × Höhe nach innen): tl/tr oben, bl/br unten. Frei nur, wenn die Sonde im ganzen
 * Kasten nichts findet (`areaFree`). Seitenkoordinaten; `measure()` misst nach.
 */
export function cornerSlot(anchor, { side = "tl", width, height, probe = null, win = null, inset = 1, points = CORNER_PROBE_POINTS, kind = anchor.kind }) {
  const { element } = anchor;
  const rect = rectOf(element);
  if (!rect) return null;
  const left = side === "tl" || side === "bl";
  const top = side === "tl" || side === "tr";
  const cornerOf = (r) => ({ x: left ? r.left + inset : r.right - inset, y: top ? r.top + inset : r.bottom - inset });
  const corner = cornerOf(rect);
  const dx = left ? 1 : -1;
  const dy = top ? 1 : -1;
  if (!areaFree(probe, element, points.map(([fx, fy]) => [corner.x + dx * width * fx, corner.y + dy * height * fy]))) return null;
  const scroll = scrollOf(win);
  const measure = () => {
    if (!element.isConnected) return null;
    const again = rectOf(element);
    if (!again) return null;
    const now = scrollOf(win);
    const point = cornerOf(again);
    return { x: point.x + now.x, y: point.y + now.y };
  };
  const x = corner.x + scroll.x;
  const y = corner.y + scroll.y;
  return { kind, side, element, fixed: false, x, y, px: x, py: y, width, height, measure, key: `${kind}:${elementId(element)}:${side}` };
}

/** Plätze ohne Ruhezonen und ohne belegte Schlüssel: Fenster-Anker gegen die Fensterkoordinaten der Zonen, alle anderen gegen die Seite. */
export function freeSlots(slots, { zones = [], taken = new Set() } = {}) {
  return slots.filter((slot) => slot && !taken.has(slot.key) && !pointInQuiet(slot.fixed ? { x: slot.x, y: slot.y } : { x: slot.px, y: slot.py }, zones, { fixed: slot.fixed }));
}

function distance(a, b) {
  return Math.hypot((a.px ?? a.x) - (b.px ?? b.x), (a.py ?? a.y) - (b.py ?? b.y));
}

/**
 * Auswahl mit Mindestabstand (auch zu `taken`) und Seed: mit `weights` je Art erst die Art nach Gewicht, dann ein
 * Platz dieser Art (Fledermäuse); ohne `weights` jeder Kandidat mit `weightOf` (Ecknetze). `onePerElement`
 * verbietet zwei am selben Element. Liefert weniger, wenn nichts mehr passt - nie einen zu nahen Platz.
 */
export function chooseSlots(candidates, count, rng, taken = [], { weights = null, weightOf = null, minDistance = 140, onePerElement = false } = {}) {
  const chosen = [];
  const usedElements = new Set(onePerElement ? taken.map((slot) => slot.element).filter(Boolean) : []);
  const allowed = (candidate) => (!onePerElement || !usedElements.has(candidate.element)) && [...taken, ...chosen].every((other) => distance(other, candidate) >= minDistance);
  const roll = (entries, weightFor) => {
    let left = rng() * entries.reduce((sum, entry) => sum + weightFor(entry), 0);
    for (let i = 0; i < entries.length; i += 1) {
      left -= weightFor(entries[i]);
      if (left <= 0) return entries[i];
    }
    return entries[entries.length - 1];
  };
  for (let n = 0; n < count; n += 1) {
    let pick = null;
    if (weights) {
      const pools = new Map();
      candidates.forEach((candidate) => {
        const kind = candidate.kind || "any";
        if (!pools.has(kind)) pools.set(kind, []);
        pools.get(kind).push(candidate);
      });
      const kinds = [...pools.keys()].filter((kind) => pools.get(kind).some(allowed));
      if (!kinds.length) break;
      const kind = roll(kinds, (k) => weights[k] || 0.1);
      const options = pools.get(kind).filter(allowed);
      pick = options[Math.min(options.length - 1, Math.floor(rng() * options.length))];
    } else {
      const options = candidates.filter(allowed);
      if (!options.length) break;
      pick = roll(options, (candidate) => (weightOf ? weightOf(candidate) : 1));
    }
    chosen.push(pick);
    if (onePerElement) usedElements.add(pick.element);
  }
  return chosen;
}

/** Der nächste freie Platz für eine landende Figur: einer der drei nächsten, nicht derselbe, nicht zu nah an Belegten. */
export function nearestFreeSlot(candidates, from, taken = [], rng = Math.random, { avoidKey = null, maxDistance = 900, minDistance = 140 } = {}) {
  const usable = candidates.filter((slot) => slot.key !== avoidKey && taken.every((other) => distance(other, slot) >= minDistance));
  if (!usable.length) return null;
  const scored = usable.map((slot) => ({ slot, d: Math.hypot(slot.px - from.x, slot.py - from.y) }))
    .filter((entry) => entry.d <= maxDistance || usable.length <= 2)
    .sort((a, b) => a.d - b.d);
  const pool = (scored.length ? scored : usable.map((slot) => ({ slot, d: 0 }))).slice(0, 3);
  return pool[Math.min(pool.length - 1, Math.floor(rng() * pool.length))].slot;
}

/** Eine je Element stabile Zahl in [0, 1): für Einzüge und Stellen, die je Karte anders, aber bei jedem Messen gleich sind. */
export function elementFraction(anchor, salt = "") {
  const text = (anchor.element.textContent || "").slice(0, 40);
  const src = anchor.element.getAttribute ? anchor.element.getAttribute("src") || anchor.element.getAttribute("alt") || "" : "";
  return (hashString(`${anchor.index}:${salt}:${text}${src}`) % 1000) / 1000;
}

