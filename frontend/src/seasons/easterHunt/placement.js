// Ostereier an echten Kanten (#754 E2, #646): der Server beschreibt ein Versteck als Art (Karte, Bild, Löwe,
// Kopfzeile, Fußzeile), Nummer und Ecke - hier wird daraus ein Punkt auf der Seite. Ein Ei liegt in einer Ecke
// seines Elements, nie über Schrift, Grafiken oder Bedienelementen darin; ist die gewünschte Ecke belegt, nimmt es
// die nächste, dann das nächste Element derselben Art, zuletzt eine Ecke der Fußzeile. So bleibt jedes Ei
// auffindbar, auch wenn eine Seite heute weniger Karten hat.
//
// Geprüft wird mit der Geometrie der Seite (Zeichenkästen der Schrift, Kästen von Grafiken und Bedienelementen),
// nicht mit einer Sonde am Fensterpunkt - so findet jedes Ei seinen Platz gleich beim Laden, auch weit unten, und
// eine Ecke hängt nicht davon ab, wohin gerade gescrollt ist. Was eine klebende Leiste am Seitenende für immer
// verdeckt (am Handy die Leiste unten über der Fußzeile), gilt als belegt. Alle Eier liegen in Seitenkoordinaten und
// scrollen mit der Seite - auch das an der Kopfzeile: es hängt oben auf der Seite unter ihr und verschwindet beim
// Scrollen darunter. Alles ohne React.

import { MEDIA_OR_CONTROL, TEXT_PAD, ownTextNodes } from "../glyphs";
import { MIN_SIZE, measureAnchors, pointSlot, probeOf, rectOf } from "../anchors";

export const EGG_SIZE = 30;
/** Höhe des gezeichneten Eis (viewBox 30 × 38) und wie weit es über seiner Mitte sitzt (translate(-50%, -55%)). */
export const EGG_HEIGHT = 38;
const LIFT = 0.55;
export const PLACE_SIDES = { "top-left": "tl", "top-right": "tr", "bottom-left": "bl", "bottom-right": "br" };
const SIDE_ORDER = ["br", "bl", "tr", "tl"];
const INSET = 6;
const MARGIN = 2;
const HEADER_FRACTIONS = { r: [0.86, 0.72], l: [0.14, 0.28] };
/** So lang ist das Bändchen, an dem das Ei unter der Kopfzeile hängt. */
export const RIBBON = 12;
/** Die Ebene der Eier: die Sonde schaut durch sie hindurch. */
export const EGG_LAYER = ".tls-eggs";

/**
 * Die Sonde für Eier: wie `probeOf`, aber die eigenen Eier zählen nicht - sonst sperrte ein Ei beim Neusuchen seinen
 * eigenen Platz und spränge an einen anderen.
 */
export function eggProbe(doc) {
  if (!doc || typeof doc.elementsFromPoint !== "function") return probeOf(doc);
  return (x, y) => doc.elementsFromPoint(x, y).find((node) => typeof node.closest !== "function" || !node.closest(EGG_LAYER)) || null;
}

/** Die Ecken in der Reihenfolge, in der sie versucht werden: die gewünschte zuerst. */
export function sidesFor(place) {
  const first = PLACE_SIDES[place] || "br";
  return [first, ...SIDE_ORDER.filter((side) => side !== first)];
}

/** Der Kasten, den ein Ei mit der Mitte (cx, cy) zeichnet. */
export function eggBox(cx, cy) {
  return { left: cx - EGG_SIZE / 2, right: cx + EGG_SIZE / 2, top: cy - EGG_HEIGHT * LIFT, bottom: cy + EGG_HEIGHT * (1 - LIFT) };
}

/** Die Eimitte für eine Ecke: der gezeichnete Kasten liegt INSET px innen an beiden Kanten. */
export function cornerCenter(rect, side) {
  const left = side === "tl" || side === "bl";
  const top = side === "tl" || side === "tr";
  return {
    x: left ? rect.left + INSET + EGG_SIZE / 2 : rect.right - INSET - EGG_SIZE / 2,
    y: top ? rect.top + INSET + EGG_HEIGHT * LIFT : rect.bottom - INSET - EGG_HEIGHT * (1 - LIFT),
  };
}

function overlaps(a, b, pad = 0) {
  return a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;
}

/**
 * Was in einem Element einen Eiplatz sperrt (Fensterkoordinaten): Grafiken und Bedienelemente mit ihrem Kasten,
 * Schrift mit ihren Zeichenkästen plus etwas Luft. Das Element selbst sperrt nicht (ein Ei darf in der Ecke eines
 * Bildes liegen, das selbst das Versteck ist). Ohne Layout (Tests ohne Rechtecke) bleibt die Liste leer.
 */
export function blockersOf(element, doc = element.ownerDocument || document) {
  const out = [];
  element.querySelectorAll(MEDIA_OR_CONTROL).forEach((node) => {
    const rect = rectOf(node);
    if (rect) out.push(rect);
  });
  if (!doc || typeof doc.createRange !== "function" || typeof doc.createTreeWalker !== "function") return out;
  const walker = doc.createTreeWalker(element, 4);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!text.textContent.trim()) continue;
    const range = doc.createRange();
    range.selectNodeContents(text);
    const rects = typeof range.getClientRects === "function" ? Array.from(range.getClientRects()) : [];
    rects.forEach((rect) => {
      if (rect.width > 0 && rect.height > 0) out.push({ left: rect.left - TEXT_PAD, right: rect.right + TEXT_PAD, top: rect.top - TEXT_PAD, bottom: rect.bottom + TEXT_PAD });
    });
  }
  return out;
}

/**
 * Wie viel vom Seitenende eine klebende Leiste unten für immer verdeckt (am Handy die Navigation): dort kann ein Ei
 * nie gesehen werden. 0 ohne solche Leiste.
 */
export function bottomCover(doc, win) {
  if (!doc || !win || typeof doc.elementsFromPoint !== "function" || typeof win.getComputedStyle !== "function") return 0;
  const hit = doc.elementsFromPoint(win.innerWidth / 2, win.innerHeight - 2).find((node) => !node.closest(EGG_LAYER));
  for (let el = hit; el && el.nodeType === 1 && el.tagName !== "BODY" && el.tagName !== "HTML"; el = el.parentElement) {
    if (win.getComputedStyle(el).position === "fixed") return Math.max(0, win.innerHeight - el.getBoundingClientRect().top);
  }
  return 0;
}

function pageHeight(doc) {
  const root = doc.documentElement;
  return Math.max(root ? root.scrollHeight : 0, doc.body ? doc.body.scrollHeight : 0);
}

/** Eckplatz für ein Ei: der Platz oder null, wenn in dieser Ecke etwas liegt (oder sie nie zu sehen ist). */
function cornerEgg(anchor, side, context) {
  const rect = rectOf(anchor.element);
  if (!rect || rect.width < EGG_SIZE + 2 * INSET + 4 || rect.height < EGG_HEIGHT + 2 * INSET + 4) return null;
  const center = cornerCenter(rect, side);
  const box = eggBox(center.x, center.y);
  if (context.blockers(anchor.element).some((blocker) => overlaps(box, blocker, MARGIN))) return null;
  const scroll = context.scroll;
  if (context.cover && box.bottom + scroll.y > context.height - context.cover) return null;
  return { x: Math.round(center.x + scroll.x), y: Math.round(center.y + scroll.y), fixed: false, side, key: `${anchor.key}:${side}`, element: anchor.element };
}

/** Steht unter dem Kasten (Fensterkoordinaten) Schrift, eine Grafik oder ein Bedienelement? Nur die Sonde weiß es. */
function contentFree(probe, box) {
  if (!probe) return true;
  const cx = (box.left + box.right) / 2;
  const cy = (box.top + box.bottom) / 2;
  const points = [[box.left + 2, box.top + 2], [box.right - 2, box.top + 2], [cx, cy], [box.left + 2, box.bottom - 2], [box.right - 2, box.bottom - 2]];
  return points.every(([x, y]) => {
    for (let node = probe(x, y); node && node.nodeType === 1 && node.tagName !== "BODY"; node = node.parentElement) {
      if (node.matches(MEDIA_OR_CONTROL)) return false;
      if (ownTextNodes(node).length) {
        const range = node.ownerDocument.createRange();
        range.selectNodeContents(node);
        const hit = Array.from(range.getClientRects?.() || []).some((r) => x >= r.left - TEXT_PAD && x <= r.right + TEXT_PAD && y >= r.top - TEXT_PAD && y <= r.bottom + TEXT_PAD);
        if (hit) return false;
      }
    }
    return true;
  });
}

/**
 * Kopfzeile: das Ei hängt an einem Bändchen oben auf der Seite unter ihrer Unterkante, rechts oder links - dort, wo
 * darunter nichts steht (das prüft die Sonde, die Stelle liegt beim Laden oben im Fenster). Ist die Seite gescrollt,
 * wartet es, bis man oben ist.
 */
function headerEgg(anchor, place, context) {
  const rect = rectOf(anchor.element);
  if (!rect) return null;
  const { scroll, probe } = context;
  if (anchor.fixed && scroll.y > 0) return { pending: true };
  const side = (PLACE_SIDES[place] || "br").endsWith("r") ? "r" : "l";
  const y = rect.bottom + RIBBON + EGG_HEIGHT * LIFT;
  for (const fraction of HEADER_FRACTIONS[side]) {
    const x = rect.left + rect.width * fraction;
    if (contentFree(probe, eggBox(x, y))) return { x: Math.round(x + scroll.x), y: Math.round(y + scroll.y), fixed: false, side: `h${side}`, key: `header:${side}:${fraction}`, element: anchor.element };
  }
  return null;
}

/** Der Löwe: das Ei liegt zu seinen Füßen. */
function heroEgg(anchor, place, context) {
  const right = (PLACE_SIDES[place] || "br").endsWith("r");
  const slot = pointSlot(anchor, { fx: right ? 0.78 : 0.22, fy: 0.92, win: context.win });
  return slot ? { x: Math.round(slot.x), y: Math.round(slot.y), fixed: false, side: right ? "br" : "bl", key: slot.key, element: anchor.element } : null;
}

/** Ein Element versuchen: der Platz, `{pending}` (Kopfzeile, solange die Seite gescrollt ist) oder null. */
function tryAnchor(anchor, spot, context) {
  if (spot.kind === "header") return headerEgg(anchor, spot.place, context);
  if (spot.kind === "hero") return heroEgg(anchor, spot.place, context);
  for (const side of sidesFor(spot.place)) {
    const found = cornerEgg(anchor, side, context);
    if (found && !context.taken.has(found.key)) return found;
  }
  return null;
}

/** So viele Blöcke der Fußzeile werden höchstens versucht (lange Linklisten). */
const FOOTER_BLOCKS = 24;

/**
 * Die Blöcke in der Fußzeile (Spalten, Bänder, Zeilen) als letzte Ausweichstellen: sind alle vier Ecken der Fußzeile
 * belegt - am Handy verdeckt die Leiste unten die unteren, und eine lange erste Zeile reicht bis in die obere rechte -,
 * liegt das Ei in der Ecke eines Blocks darin. Seit die Vereinsschriften wirklich laden (#1228), laufen Zeilen anders
 * um als mit der Ersatzschrift des Geräts; so bleibt das Ei der Fußzeile trotzdem auffindbar.
 */
function footerBlocks(doc) {
  const footer = doc && typeof doc.querySelector === "function" ? doc.querySelector("footer") : null;
  if (!footer) return [];
  const [minWidth, minHeight] = MIN_SIZE.footer;
  return Array.from(footer.querySelectorAll("div, section, nav, ul"))
    .filter((element) => {
      const rect = rectOf(element);
      return Boolean(rect && rect.width >= minWidth && rect.height >= minHeight);
    })
    .slice(0, FOOTER_BLOCKS)
    .map((element, index) => ({ element, key: `footer-block:${index}` }));
}

function contextFor({ doc, win, probe, taken }) {
  const cache = new Map();
  return {
    win,
    probe,
    taken,
    scroll: { x: (win && win.scrollX) || 0, y: (win && win.scrollY) || 0 },
    cover: bottomCover(doc, win),
    height: pageHeight(doc),
    blockers(element) {
      if (!cache.has(element)) cache.set(element, blockersOf(element, doc));
      return cache.get(element);
    },
  };
}

/**
 * Wo ein Ei auf dieser Seite liegt: Seitenkoordinaten der Eimitte, die Ecke, das Element und ob es ausweichen
 * musste - `{pending: true}` nur für die Kopfzeile, solange die Seite gescrollt ist; null nur, wenn die Seite gar
 * keine passende Kante und keine Fußzeile mit einer freien Ecke (auch in ihren Blöcken) hat. `taken`: schon
 * belegte Plätze.
 */
export function placeEgg(egg, { doc = document, win = typeof window === "undefined" ? null : window, probe = eggProbe(doc), taken = new Set(), context = null } = {}) {
  const ctx = context || contextFor({ doc, win, probe, taken });
  const spot = egg?.spot || {};
  const kind = spot.kind || "card";
  const anchors = measureAnchors(doc, win, { kinds: [kind] });
  const start = anchors.length ? Math.max(0, Number(spot.index) || 0) % anchors.length : 0;
  const ordered = [...anchors.slice(start), ...anchors.slice(0, start)];
  for (const anchor of ordered) {
    const found = tryAnchor(anchor, { ...spot, kind }, ctx);
    if (found?.pending) return { pending: true };
    if (found && !ctx.taken.has(found.key)) return { ...found, kind, fallback: anchor !== ordered[0] };
  }
  if (kind !== "footer") {
    for (const anchor of measureAnchors(doc, win, { kinds: ["footer"] })) {
      const found = tryAnchor(anchor, { ...spot, kind: "footer" }, ctx);
      if (found) return { ...found, kind: "footer", fallback: true };
    }
  }
  for (const anchor of footerBlocks(doc)) {
    const found = tryAnchor(anchor, { ...spot, kind: "footer" }, ctx);
    if (found) return { ...found, kind: "footer", fallback: true };
  }
  return null;
}

/**
 * Alle Eier einer Seite, der Reihe nach (zwei Eier nie in derselben Ecke). `placed` hält schon gesetzte Plätze
 * fest - die bleiben, wie sie sind; neu gesucht wird nur für wartende Eier.
 */
export function placeEggs(eggs, { placed = {}, doc = document, win = typeof window === "undefined" ? null : window, probe = eggProbe(doc) } = {}) {
  const taken = new Set(Object.values(placed).filter((place) => place && !place.pending).map((place) => place.key));
  const context = contextFor({ doc, win, probe, taken });
  const out = {};
  (eggs || []).forEach((egg) => {
    const before = placed[egg.egg_no];
    if (before && !before.pending) {
      out[egg.egg_no] = before;
      return;
    }
    const place = placeEgg(egg, { doc, win, context });
    out[egg.egg_no] = place;
    if (place && !place.pending) taken.add(place.key);
  });
  return out;
}
