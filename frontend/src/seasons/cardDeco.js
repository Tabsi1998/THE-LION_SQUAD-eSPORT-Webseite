// Deko an Karten (Jahreszeiten IV, Variante B, #1091-#1094): Lichterkette, Osterei, Luftschlange und Wimpelkette hingen
// bisher nur an Kopfzeile, Fußzeile oder am Seitenrand - dort hebt sich nichts. Jetzt kommen sie zusätzlich an einige
// Karten, die sich heben (#1071), und reagieren, wenn sich genau diese Karte hebt. Hier liegt, was alle vier teilen:
// welche Karten in Frage kommen, wie viele je Fensterhöhe Deko tragen, wie sie gewählt werden (Saat je Seite und Jahr,
// Abstand, nie zwei an einer Karte) und ob ein Kasten neben der Karte frei ist. Die Anzeige und die Reaktion liegen in
// den Saisons (christmas/CardChains.jsx, easter/CardEggs.jsx, carnival/CardStreamers.jsx, birthday/CardGarlands.jsx);
// die App wählt ihre Karten nach denselben Regeln (mobile/src/seasons/cardDeco.tsx).

import { chooseSlots, clearOf, measureAnchors, neighbourRects, rectOf, scrollOf } from "./anchors";
import { LIFTING_CLASS, cardKey } from "./cardLift";
import { blocksPoint } from "./glyphs";
import { effectClasses, pageClass, scaleForViewport } from "./intensity";

/** Höchstens so ein Anteil der Karten im Fenster trägt Deko - nie jede Karte. */
export const CARD_SHARE = 0.4;
/** Abstand zwischen zwei Karten mit Deko (Seitenkoordinaten, px). */
export const CARD_DISTANCE = 280;
/** Kleinere Karten tragen nichts (Breite, Höhe). */
export const CARD_MIN = [180, 90];
/** Das Band einer hängenden Deko (Lichterkette, Wimpel) beginnt so weit über der Unterkante - wie an der Begrüßungskarte der App. */
export const CARD_BAND = 16;
/** Die eigenen Ebenen der Saisons: die Sonde schaut durch sie hindurch. */
export const DECO_LAYERS = ".tls-card-deco, .tls-eggs, .tls-snowcaps, .tls-cwebs, .tls-hbats, .tls-streamers, .tls-garlands, .tls-lights, .tls-easter-layer";

/**
 * Wie viele Karten je Fensterhöhe Deko tragen dürfen: die Ecken der Seitenklasse (lebendig 3, bei „voll“ 4, mittel 2,
 * ruhig 1, still keine; „dezent“ eine; schmale Fenster eine, Handys keine) - und nie mehr als vier von zehn Karten im
 * Fenster, mindestens aber eine.
 */
export function cardDecoCount(pathname, effective = "normal", width = 1280, cardsInView = Infinity) {
  const caps = scaleForViewport(effectClasses(pageClass(pathname), effective), width);
  if (!caps.corner || cardsInView <= 0) return 0;
  return Math.min(caps.corner, Math.max(1, Math.round(cardsInView * CARD_SHARE)));
}

/** Die Karten, die sich heben und Saison-Deko tragen dürfen - mit Anker-Schlüssel, Fenster- und Seitenrechteck. */
export function liftingCards(doc, win, { margin = null, min = CARD_MIN } = {}) {
  return measureAnchors(doc, win, { kinds: ["card"], minSize: { card: min }, limits: { card: 40 }, inViewMargin: margin })
    .filter((anchor) => anchor.element.classList && anchor.element.classList.contains(LIFTING_CLASS))
    .map((anchor) => ({ ...anchor, card: cardKey(anchor.element) }));
}

/**
 * Ist an einem Fensterpunkt nichts Lesbares (Schrift, Bild, Grafik, Bedienelement)? Eigene Ebenen zählen nicht;
 * außerhalb des Fensters weiß niemand etwas (frei); ohne `elementsFromPoint` (Tests ohne Layout) ist alles frei.
 */
export function roomAt(doc, win, x, y, own = DECO_LAYERS) {
  if (!doc || typeof doc.elementsFromPoint !== "function") return true;
  if (win && (x < 0 || y < 0 || x > win.innerWidth || y > win.innerHeight)) return true;
  const hit = doc.elementsFromPoint(x, y).find((node) => typeof node.closest !== "function" || !node.closest(own));
  for (let node = hit; node && node.nodeType === 1 && node !== doc.body && node !== doc.documentElement; node = node.parentElement) {
    if (blocksPoint(node, x, y)) return false;
  }
  return true;
}

/**
 * Ist ein Kasten frei (Fensterkoordinaten `left/top/right/bottom`)? Kein Punkt darin auf Schrift, Bild oder Bedienung
 * (Raster alle `step` px) und keine andere Karte darunter. `owner` ist die Karte selbst - sie darf darunter liegen.
 */
export function boxFree(doc, win, box, owner, { step = 6, neighbours = null } = {}) {
  if (box.right <= box.left || box.bottom <= box.top) return true;
  const scroll = scrollOf(win);
  const rects = neighbours || neighbourRects(doc, win);
  if (!clearOf(rects, owner, (box.left + box.right) / 2 + scroll.x, box.top + scroll.y, box.right - box.left, box.bottom - box.top)) return false;
  for (let y = box.top + 1; y <= box.bottom - 1 + 0.01; y += step) {
    for (let x = box.left + 1; x <= box.right - 1 + 0.01; x += step) if (!roomAt(doc, win, x, y)) return false;
    if (!roomAt(doc, win, box.right - 1, y)) return false;
  }
  return roomAt(doc, win, box.left + 1, box.bottom - 1) && roomAt(doc, win, box.right - 1, box.bottom - 1);
}

/** Ragt ein Kasten (Fensterkoordinaten) über den Rand des Inhalts hinaus? Dann scrollte die Seite seitlich. */
export function overflows(doc, win, box, pad = 2) {
  const width = (doc && doc.documentElement && doc.documentElement.clientWidth) || (win && win.innerWidth) || 1280;
  const scroll = scrollOf(win);
  return box.left + scroll.x < pad || box.right + scroll.x > width + scroll.x - pad;
}

/**
 * Eine Deko an einer Karte als Eintrag: Kartenrechteck in Seitenkoordinaten (`x`, `y` = obere linke Ecke, `width`,
 * `height`), der Kartenschlüssel (`card`), die eigene Form der Saison (`geo`) und ein Ankerpunkt (`px`/`py`) für den
 * Abstand zu anderen.
 */
export function decoItem(anchor, kind, geo, win) {
  const rect = anchor.rect;
  const scroll = scrollOf(win);
  return {
    key: `${kind}:${anchor.key}`,
    anchorKey: anchor.key,
    index: anchor.index,
    kind,
    element: anchor.element,
    card: anchor.card || cardKey(anchor.element),
    x: rect.left + scroll.x,
    y: rect.top + scroll.y,
    width: rect.width,
    height: rect.height,
    px: rect.left + scroll.x + (geo.ax ?? rect.width / 2),
    py: rect.top + scroll.y + (geo.ay ?? 0),
    fixed: false,
    geo,
  };
}

/** Wählt neue Karten: Saat, Abstand (auch zu den schon belegten), nie zwei an einer Karte. */
export function chooseDeco(candidates, count, rng, taken = [], minDistance = CARD_DISTANCE) {
  return chooseSlots(candidates, count, rng, taken, { minDistance, onePerElement: true });
}

/** Misst eine Deko nach: wo ihre Karte jetzt liegt - null, wenn sie weg ist. */
export function remeasure(item, win) {
  if (!item.element || !item.element.isConnected) return null;
  const rect = rectOf(item.element);
  if (!rect) return null;
  const scroll = scrollOf(win);
  return { x: rect.left + scroll.x, y: rect.top + scroll.y, width: rect.width, height: rect.height, rect };
}
