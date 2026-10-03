// Wo der Kopf des Löwen sitzt (gemeinsam für Partyhut #746 und Hasenohren #645): der Scheitel wird aus dem Bild
// gelesen, damit Hut und Ohren auch auf einem eigenen Vereinslogo richtig sitzen. Reine Rechnung bis auf das Lesen.

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
