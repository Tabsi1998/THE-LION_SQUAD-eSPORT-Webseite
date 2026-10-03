// Wo Partyhut und Luftschlangen sitzen (Fasching F2 #746, F3 #747): der Hut auf dem Kopf des echten Löwen - aus dem
// Bild gelesen, damit er auch auf einem eigenen Vereinslogo richtig sitzt -, die Luftschlangen an echten Kanten, nur
// dort, wo darunter nichts Lesbares hängt. Reine Rechnung bis auf das Lesen des Bildes.
import { seasonRng } from "../rng";

/** Ohne lesbares Bild (fremde Herkunft, kein Canvas): wo der Kopf bei unseren eigenen Bildern sitzt. */
export const HEAD_FALLBACK = { wordmark: { x: 0.11, y: 0.06 }, mascot: { x: 0.47, y: 0.1 } };
/** In welchem Teil der Breite der Kopf gesucht wird: im Schriftzug links, beim Maskottchen in der Mitte. */
export const HEAD_RANGE = { wordmark: [0, 0.32], mascot: [0.2, 0.75] };

const cache = new Map();

/**
 * Der Scheitel des Löwen als Anteil des Bildes (0…1): die oberste Zeile mit deckenden Punkten im Suchbereich, die
 * Mitte der deckenden Punkte in einem schmalen Band darunter. `image` ist ein geladenes <img>; null, wenn es nicht geht.
 */
export function headTop(image, kind = "wordmark", doc = typeof document === "undefined" ? null : document) {
  const src = image?.currentSrc || image?.src || "";
  const key = `${kind}:${src}`;
  if (cache.has(key)) return cache.get(key);
  let found = null;
  try {
    const width = Number(image?.naturalWidth) || 0;
    const height = Number(image?.naturalHeight) || 0;
    if (doc && width && height) {
      const scale = Math.min(1, 240 / width);
      const cw = Math.max(1, Math.round(width * scale));
      const ch = Math.max(1, Math.round(height * scale));
      const canvas = doc.createElement("canvas");
      canvas.width = cw;
      canvas.height = ch;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(image, 0, 0, cw, ch);
      found = scanHead(ctx.getImageData(0, 0, cw, ch).data, cw, ch, HEAD_RANGE[kind] || HEAD_RANGE.wordmark);
    }
  } catch {
    found = null;
  }
  if (found) cache.set(key, found);
  return found;
}

/** Die Suche selbst (für Tests getrennt): RGBA-Daten, Breite, Höhe, Suchbereich als Anteile. */
export function scanHead(data, width, height, [from, to]) {
  const x0 = Math.max(0, Math.floor(width * from));
  const x1 = Math.min(width, Math.ceil(width * to));
  const opaque = (x, y) => data[(y * width + x) * 4 + 3] > 140;
  let top = -1;
  for (let y = 0; y < height && top < 0; y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (opaque(x, y)) {
        top = y;
        break;
      }
    }
  }
  if (top < 0) return null;
  const band = Math.max(2, Math.round(height * 0.1));
  let sum = 0;
  let count = 0;
  for (let y = top; y < Math.min(height, top + band); y += 1) {
    for (let x = x0; x < x1; x += 1) {
      if (opaque(x, y)) {
        sum += x;
        count += 1;
      }
    }
  }
  return { x: Math.round((sum / count / width) * 1000) / 1000, y: Math.round((top / height) * 1000) / 1000 };
}

/**
 * Die Luftschlangen einer Seite in diesem Jahr: wie viele je Seite, wie lang, wie gekräuselt, welche Farben - aus
 * dem Jahres-Seed und der Route, damit jede Seite etwas anders aussieht und ein Neuladen nichts ändert.
 */
export function streamerPlan(year, route = "/") {
  const rng = seasonRng({ season: "carnival", year, route }, "streamers");
  const palette = [["#29B6E8", "#7fd6f5"], ["#FFD700", "#ffe866"], ["#ff4fa3", "#ff9ccb"], ["#3ddc84", "#8ff0bb"], ["#a66bff", "#cbb0ff"], ["#ff8a3d", "#ffbb8a"]];
  const make = (side) => Array.from({ length: 1 + Math.floor(rng() * 2) }, (_, index) => ({
    side,
    index,
    offset: Math.round(10 + rng() * 26 + index * 18),
    length: Math.round(70 + rng() * 80),
    curl: Math.round((5 + rng() * 7) * 10) / 10,
    turns: Math.round((2.5 + rng() * 2.5) * 10) / 10,
    colors: palette[Math.floor(rng() * palette.length)],
    sway: Math.round((4.5 + rng() * 2.5) * 10) / 10,
    delay: Math.round(rng() * 600),
  }));
  return [...make("left"), ...make("right")];
}

/** Die Form einer Luftschlange als SVG-Pfad: oben befestigt, nach unten gekräuselt, unten etwas weiter schwingend. */
export function streamerPath({ length, curl, turns }) {
  const steps = 32;
  const points = Array.from({ length: steps + 1 }, (_, i) => {
    const s = i / steps;
    const x = Math.sin(s * turns * Math.PI * 2) * curl * (0.35 + 0.65 * s);
    return `${(12 + x).toFixed(1)} ${(s * length).toFixed(1)}`;
  });
  return `M ${points[0]} L ${points.slice(1).join(" L ")}`;
}
