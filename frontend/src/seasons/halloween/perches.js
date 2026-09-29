// Fledermaus-Plätze (H7, #695) - jetzt als Halloween-Plan über dem gemeinsamen Anker-Kern (Seasonal Core C1, #721,
// ../anchors.js). Eine Fledermaus hängt unter einer Kante (Menüpunkt, Kopfzeile, Unterkante einer Karte oder eines
// Bildes, Mähne des Löwen) oder sitzt auf einer Ecke (Oberkante einer Karte oder eines Rahmens, Fußzeilen-Strich).
// Hier steht nur noch, welche Kante welche Plätze bekommt; Messen, Sonde, Ruhezonen, Nachbarn, Belegung und
// Auswahl liegen im Kern. Alles ohne React; die Anzeige liegt in HangingBats.jsx.

import { ANCHOR_SELECTORS, POSE as CORE_POSE, chooseSlots, clearOf, edgeSlot, elementFraction, freeSlots, measureAnchors, nearestFreeSlot, neighbourRects, pointSlot, probeOf, roomAt } from "../anchors";
import { measureQuietZones } from "../quiet";

export const NAV_SELECTOR = ANCHOR_SELECTORS.nav;
export const HEADER_SELECTOR = ANCHOR_SELECTORS.header;
export const CARD_SELECTOR = ANCHOR_SELECTORS.card;
export const FRAME_SELECTOR = ANCHOR_SELECTORS.frame;
export const IMAGE_SELECTOR = ANCHOR_SELECTORS.image;
export const LION_SELECTOR = "[data-season-anchor='lion']";
export const FOOTER_LINE_SELECTOR = ANCHOR_SELECTORS.footerLine;
export const MIN_DISTANCE = 140;
export const MAX_CARDS = 16;
export const MAX_IMAGES = 6;
/** Wie oft welche Art drankommt, wenn es sie auf der Seite gibt. */
export const KIND_WEIGHTS = { nav: 0.2, header: 0.12, card: 0.3, frame: 0.12, image: 0.1, lion: 0.06, footer: 0.05 };
/** Sitzt (Oberkante, Ecke) oder hängt (Unterkante)? */
export const POSE = CORE_POSE;
/** Höhe der Figur je Haltung, in Vielfachen der Breite (`size`). */
export const SHAPE_HEIGHT = { hang: 1.55, sit: 1.15 };

/** Karten und Rahmen: zwei Sitzplätze auf den oberen Ecken, ein Hängeplatz unter der Unterkante - wo Platz ist. */
function boxPerches(anchor, { rects, probe, win }) {
  const out = [];
  const { element, rect } = anchor;
  const scroll = { x: (win && win.scrollX) || 0, y: (win && win.scrollY) || 0 };
  const inset = 16 + elementFraction(anchor) * 18;
  const sitHeight = 22 * SHAPE_HEIGHT.sit;
  [inset, -inset].forEach((edgeInset, index) => {
    const cornerX = index === 0 ? rect.left + inset : rect.right - inset;
    if (!roomAt(probe, cornerX, rect.top - sitHeight * 0.6, element, win)) return;
    if (!clearOf(rects, element, cornerX + scroll.x, rect.top + scroll.y - sitHeight, 22, sitHeight)) return;
    out.push(edgeSlot(anchor, { edge: "top", inset: edgeInset, minWidth: 120, pose: POSE.sit, size: 22, index, win }));
  });
  const hangHeight = 24 * SHAPE_HEIGHT.hang;
  const underX = rect.left + rect.width * 0.5;
  if (!roomAt(probe, underX, rect.bottom + hangHeight * 0.7, element, win)) return out;
  if (!clearOf(rects, element, underX + scroll.x, rect.bottom + scroll.y, 24, hangHeight)) return out;
  out.push(edgeSlot(anchor, { edge: "bottom", fraction: 0.5, dy: -1, minWidth: 120, pose: POSE.hang, size: 24, index: 2, win }));
  return out;
}

/** Freistehende Bilder (nicht in Karten): unter der Unterkante, an einer je Bild festen Stelle - wenn darunter Platz ist. */
function imagePerch(anchor, { rects, probe, win }) {
  const { element, rect } = anchor;
  const scroll = { x: (win && win.scrollX) || 0, y: (win && win.scrollY) || 0 };
  const fraction = 0.25 + elementFraction(anchor, "image") * 0.5;
  const x = rect.left + rect.width * fraction;
  const hangHeight = 24 * SHAPE_HEIGHT.hang;
  if (!roomAt(probe, x, rect.bottom + hangHeight * 0.7, element, win)) return null;
  if (!clearOf(rects, element, x + scroll.x, rect.bottom + scroll.y, 24, hangHeight)) return null;
  return edgeSlot(anchor, { edge: "bottom", fraction, dy: -1, minWidth: 160, pose: POSE.hang, size: 24, win });
}

/** Der Halloween-Plan je Ankerart. */
function planFor(anchor, ctx) {
  const { win } = ctx;
  switch (anchor.kind) {
    case "nav":
      return [edgeSlot(anchor, { edge: "bottom", fraction: 0.5, dy: 2, minWidth: 24, pose: POSE.hang, size: 24, win })];
    case "header":
      // Die Unterkante der Kopfzeile: drei Plätze über die Breite, hängend; klebt sie oben, hängen sie am Fenster.
      return [0.18, 0.5, 0.82].map((fraction, index) => edgeSlot(anchor, { edge: "bottom", fraction, dy: 1, pose: POSE.hang, size: 22, index, win }));
    case "card":
    case "frame":
      return boxPerches(anchor, ctx);
    case "image":
      return [imagePerch(anchor, ctx)];
    case "hero":
      // Hängend wie bisher (#661): die Figur hängt in die Mähne hinein; sitzend schwebte sie über dem Kopf (Probe 29.09.).
      return [pointSlot(anchor, { kind: "lion", fx: 0.68, fy: 0.16, minWidth: 80, pose: POSE.hang, size: 26, win })];
    case "footerLine":
      // Der Strich über dem Impressum (H16): zwei Sitzplätze links, damit Links und Kürbisse frei bleiben.
      return [0.06, 0.16].map((fraction, index) => edgeSlot(anchor, { kind: "footer", edge: "top", fraction, pose: POSE.sit, size: 22, index, win }));
    default:
      return [];
  }
}

/**
 * Alle Plätze der Seite - ohne Ruhezonen. `taken` sind belegte Schlüssel, die nicht angeboten werden; `probe`
 * ersetzt `elementFromPoint` (Tests). Fenster-Anker werden gegen die Fensterkoordinaten der Ruhezonen geprüft,
 * alle anderen gegen die Seite.
 */
export function measurePerches(doc = document, win = typeof window === "undefined" ? null : window, { zones = measureQuietZones(doc, win), taken = new Set(), probe = probeOf(doc) } = {}) {
  const anchors = measureAnchors(doc, win, { kinds: ["nav", "header", "card", "frame", "image", "hero", "footerLine"], limits: { card: MAX_CARDS, frame: MAX_CARDS, image: MAX_IMAGES } });
  const ctx = { rects: neighbourRects(doc, win), probe, win };
  return freeSlots(anchors.flatMap((anchor) => planFor(anchor, ctx)), { zones, taken });
}

/** Auswahl: erst die Art nach Gewicht, dann ein Platz dieser Art - nie zwei näher als der Mindestabstand (auch zu `taken`). */
export function choosePerches(candidates, count, rng, taken = []) {
  return chooseSlots(candidates, count, rng, taken, { weights: KIND_WEIGHTS, minDistance: MIN_DISTANCE });
}

/** Der nächste freie Platz für eine landende Fledermaus: einer der drei nächsten, nicht derselbe, nicht zu nah an Belegten. */
export function nearestFreePerch(candidates, from, taken = [], rng = Math.random, { avoidKey = null, maxDistance = 900 } = {}) {
  return nearestFreeSlot(candidates, from, taken, rng, { avoidKey, maxDistance, minDistance: MIN_DISTANCE });
}
