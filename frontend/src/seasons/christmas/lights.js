// Lichterkette (Jahreszeiten II S8, #639; Weihnachten X1, #734): ein Draht, der an Nägeln unter der Kopfzeile (und
// oben in der Fußzeile) hängt und zwischen ihnen durchhängt, daran Lämpchen in Vereinsfarben und warmem Weiß - keine
// zwei gleich: eigene Helligkeit, eigenes Aufglimmen (Dauer und Versatz), ein paar flackern selten. Wo ein Logo,
// Knopf oder Link in das Band ragt, bleibt der Draht, aber kein Lämpchen (`gaps`). Alles aus dem Jahres-Seed (C4):
// dieses Jahr immer dieselbe Kette. Reine Rechnung; die Anzeige liegt in LightChain.jsx.

import { between, seasonRng } from "../rng";

/** Das Band, in dem die Kette hängt (px): unter der Kopfzeile bleibt es innerhalb der freien Unterkante. */
export const BAND_HEIGHT = 18;
export const INSET = 12;
/** Farben: Vereinsblau, warmes Weiß, Gold, ein Hauch Rot, kaltes Weiß. */
export const COLORS = { blue: "#29B6E8", warm: "#ffd9a0", gold: "#ffc857", red: "#e8453c", white: "#eef7ff" };
/** Wie oft welche Farbe vorkommt - das Blau des Vereins führt, warmes Weiß trägt, Gold und Rot setzen Akzente. */
const PALETTE = ["blue", "warm", "blue", "gold", "warm", "blue", "red", "warm", "white"];
/** Ab dieser Fensterbreite hängt die Kette (darunter ist die Kopfzeile zu niedrig). */
export const MIN_WIDTH = 768;

function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Die Höhe des Drahts an der Stelle t (0–1) eines Abschnitts mit Durchhang `sag`: eine Parabel. */
export function wireY(t, sag, top = 1) {
  return top + 4 * sag * t * (1 - t);
}

/** Der Draht als SVG-Pfad: je Abschnitt eine Kurve durch den tiefsten Punkt. */
export function wirePath(segments, top = 1) {
  if (!segments.length) return "";
  let d = `M ${segments[0].from.toFixed(1)} ${top}`;
  segments.forEach((segment) => {
    const mid = (segment.from + segment.to) / 2;
    d += ` Q ${mid.toFixed(1)} ${(top + 2 * segment.sag).toFixed(1)} ${segment.to.toFixed(1)} ${top}`;
  });
  return d;
}

/** Liegt x in einer Lücke (Logo, Knopf, Link im Band)? */
export function inGap(x, gaps = []) {
  return gaps.some(([from, to]) => x >= from && x <= to);
}

/**
 * Die Kette über eine Breite: Nägel alle 190–260 px (mit Versatz), Abschnitte mit eigenem Durchhang, Lämpchen alle
 * 52–70 px mit eigener Farbe (nie zweimal dieselbe nebeneinander), Größe, Helligkeit, Glimmen und seltenem Flackern.
 * `anchor` trennt Kopfzeile und Fußzeile im Seed; `gaps` sind x-Bereiche ohne Lämpchen.
 */
export function chainLayout({ width, year, salt = "", anchor = "header", height = BAND_HEIGHT, gaps = [] }) {
  const rng = seasonRng({ season: "christmas", year, route: `lights:${anchor}`, salt }, "chain");
  const span = Math.max(0, width - INSET * 2);
  if (span < 120) return { width, height, nails: [], segments: [], bulbs: [], wire: "" };
  const count = Math.max(2, Math.round(span / between(rng, 190, 260)) + 1);
  const nails = Array.from({ length: count }, (_, i) => {
    const base = INSET + (span * i) / (count - 1);
    return i === 0 || i === count - 1 ? base : base + between(rng, -12, 12);
  });
  const maxSag = (height - 8) * 0.9;
  const segments = nails.slice(1).map((to, i) => ({ from: nails[i], to, sag: between(rng, maxSag * 0.6, maxSag) }));
  const order = shuffle(PALETTE, rng);
  let paletteIndex = 0;
  let lastColor = null;
  const nextColor = () => {
    let color = order[paletteIndex % order.length];
    paletteIndex += 1;
    if (color === lastColor) {
      color = order[paletteIndex % order.length];
      paletteIndex += 1;
    }
    lastColor = color;
    return color;
  };
  const bulbs = [];
  segments.forEach((segment, segmentIndex) => {
    const length = segment.to - segment.from;
    const perSegment = Math.max(1, Math.round(length / between(rng, 52, 70)));
    for (let n = 0; n < perSegment; n += 1) {
      const t = (n + 1) / (perSegment + 1) + between(rng, -0.04, 0.04);
      const x = segment.from + length * t;
      const wire = wireY(t, segment.sag);
      // Alle Zufallszahlen werden immer gezogen, damit eine Lücke die anderen Lämpchen nicht verändert.
      const bulb = {
        index: bulbs.length,
        segment: segmentIndex,
        x: Math.round(x * 10) / 10,
        y: Math.round((wire + 3.6) * 10) / 10,
        wire: Math.round(wire * 10) / 10,
        color: nextColor(),
        radius: Math.round(between(rng, 2.5, 3.3) * 10) / 10,
        brightness: Math.round(between(rng, 0.7, 1) * 100) / 100,
        glowDuration: Math.round(between(rng, 2.6, 6) * 10) / 10,
        glowDelay: -Math.round(between(rng, 0, 6) * 10) / 10,
        flicker: rng() < 0.18,
        flickerDelay: Math.round(between(rng, 3, 17) * 10) / 10,
      };
      if (!inGap(bulb.x, gaps)) bulbs.push(bulb);
    }
  });
  return { width, height, nails, segments, bulbs, wire: wirePath(segments) };
}
