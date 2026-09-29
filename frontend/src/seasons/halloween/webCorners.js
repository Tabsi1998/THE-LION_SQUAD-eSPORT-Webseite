// Kleine Netze an echten Ecken (H12, #700) - jetzt als Halloween-Plan über dem gemeinsamen Anker-Kern (Seasonal
// Core C1, #721, ../anchors.js): die oberen Innenecken von Karten, Kacheln, Rahmen und der Fußzeile. Je Fenster
// höchstens eine Handvoll, mit Abstand, nie über Text, Bild oder Bedienelement (Sonde) und nie in Ruhezonen. Das
// große Netz in der Fensterecke bleibt der Blickfang; diese hier sind kleiner und blasser. Hier steht nur noch
// Größe, Blässe und Nabe; Messen, Sonde und Auswahl liegen im Kern. Alles ohne React; die Anzeige liegt in CornerWebs.jsx.

import { hashString, mulberry32 } from "../rng";
import { measureQuietZones } from "../quiet";
import { chooseSlots, cornerSlot, freeSlots, measureAnchors, probeOf } from "../anchors";
import { EXTENT, HUB } from "./web";

export const BOX_SELECTOR = "[data-season-anchor='card'], [data-season-perch='card'], [data-season-perch='frame']";
export const FOOTER_SELECTOR = "footer";
export const MIN_DISTANCE = 320;
export const RADIUS = [22, 34];
export const OPACITY = [0.45, 0.68];
export const MAX_BOXES = 24;

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
 * Ecken im Fenster (plus Rand), die ein Netz tragen können. `taken` sind belegte Schlüssel; `probe` ersetzt
 * `elementFromPoint` (Tests); `seed` macht Größe und Blässe je Ecke stabil.
 */
export function measureWebCorners(doc = document, win = typeof window === "undefined" ? null : window, { zones = measureQuietZones(doc, win), taken = new Set(), probe = probeOf(doc), seed = 0.5, margin = 60 } = {}) {
  const anchors = measureAnchors(doc, win, {
    kinds: ["box", "footer"],
    selectors: { box: BOX_SELECTOR, footer: FOOTER_SELECTOR },
    minSize: { box: [160, 90], footer: [160, 90] },
    limits: { box: MAX_BOXES },
    inViewMargin: margin,
  });
  const corners = anchors.flatMap((anchor) => ["tl", "tr"].map((side) => {
    const spec = webSpec(`${seed}:${anchor.kind === "footer" ? "footer" : anchor.index}:${side}`);
    const corner = cornerSlot(anchor, { side, width: spec.width, height: spec.height, probe, win });
    return corner ? { ...corner, spec } : null;
  }));
  return freeSlots(corners, { zones, taken });
}

/** Auswahl: nie zwei am selben Element, nie näher als der Mindestabstand (auch zu `taken`); die Fußzeile kommt etwas lieber dran. */
export function chooseWebCorners(candidates, count, rng, taken = []) {
  return chooseSlots(candidates, count, rng, taken, { minDistance: MIN_DISTANCE, onePerElement: true, weightOf: (candidate) => (candidate.kind === "footer" ? 1.6 : 1) });
}
