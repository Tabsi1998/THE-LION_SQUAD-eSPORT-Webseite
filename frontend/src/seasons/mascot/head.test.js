import { HEAD_RANGE, headTop, scanCrown, scanHead } from "./head";

// Wo der Kopf des Löwen sitzt (für Partyhut und Hasenohren): der Scheitel aus dem Bild gelesen - auch für ein eigenes
// Vereinslogo -, einmal je Bild; ohne lesbares Bild nichts (dann gilt der Ersatz der Aufrufer).

/** Ein RGBA-Bild mit deckenden Rechtecken [x0, y0, x1, y1). */
function image(width, height, blocks) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (const [x0, y0, x1, y1] of blocks) {
    for (let y = y0; y < y1; y += 1) for (let x = x0; x < x1; x += 1) data[(y * width + x) * 4 + 3] = 255;
  }
  return data;
}

test("Scheitel: oberste deckende Zeile im Suchbereich, Mitte der deckenden Punkte darunter", () => {
  // Kopf links (Schriftzug) ab Zeile 10; rechts davon Schrift, die schon ab Zeile 2 beginnt - die zählt nicht.
  const data = image(100, 50, [[6, 10, 14, 30], [60, 2, 90, 20]]);
  expect(scanHead(data, 100, 50, HEAD_RANGE.wordmark)).toEqual({ x: 0.095, y: 0.2 });
  expect(scanHead(data, 100, 50, [0.5, 1])).toEqual({ x: 0.745, y: 0.04 });
  expect(scanHead(image(40, 40, []), 40, 40, [0, 1])).toBeNull();
});

test("Kopfmitte (#855): Mitte des Kopfes von hinten bis zur Schnauze, dort die oberste Zeile - nicht die Mähnenspitze", () => {
  // Mähne hinten hoch (Spalten 4–8 ab Zeile 4), Kopf breit ab Zeile 10 bis Spalte 28 - die Mitte liegt bei Spalte 16.
  const data = image(100, 50, [[4, 4, 9, 30], [4, 10, 29, 30], [60, 2, 90, 20]]);
  expect(scanHead(data, 100, 50, HEAD_RANGE.wordmark).x).toBeLessThan(0.1);
  expect(scanCrown(data, 100, 50, HEAD_RANGE.wordmark)).toEqual({ x: 0.16, y: 0.2 });
  expect(scanCrown(image(40, 40, []), 40, 40, [0, 1])).toBeNull();
  // Die Stelle entlang des Kopfes: 0 = linker Rand, 1 = rechter Rand.
  expect(scanCrown(data, 100, 50, HEAD_RANGE.wordmark, 0).x).toBe(0.04);
  expect(scanCrown(data, 100, 50, HEAD_RANGE.wordmark, 1).x).toBe(0.28);
});

test("halb durchsichtige Ränder zählen nicht als Kopf", () => {
  const data = image(20, 20, [[5, 8, 10, 12]]);
  for (let x = 0; x < 20; x += 1) data[(3 * 20 + x) * 4 + 3] = 90;
  expect(scanHead(data, 20, 20, [0, 1]).y).toBe(0.4);
});

test("Scheitel aus einem geladenen Bild - einmal gelesen, danach aus dem Speicher; ohne Canvas nichts", () => {
  const data = image(60, 30, [[20, 6, 30, 20]]);
  const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })) };
  const doc = { createElement: vi.fn(() => ({ getContext: () => ctx })) };
  const img = { currentSrc: "/lion-mascot-test.png", naturalWidth: 60, naturalHeight: 30 };
  const first = headTop(img, "mascot", doc);
  expect(first).toEqual({ x: 0.408, y: 0.2 });
  expect(headTop(img, "mascot", doc)).toBe(first);
  expect(doc.createElement).toHaveBeenCalledTimes(1);
  // Fremde Herkunft: der Canvas ist „vergiftet“, das Lesen wirft - dann gilt der Ersatz der Aufrufer.
  const tainted = { createElement: () => ({ getContext: () => ({ drawImage: () => {}, getImageData: () => { throw new Error("tainted"); } }) }) };
  expect(headTop({ src: "https://cdn.example/logo.png", naturalWidth: 60, naturalHeight: 30 }, "wordmark", tainted)).toBeNull();
  expect(headTop({ src: "/not-loaded.png", naturalWidth: 0, naturalHeight: 0 }, "wordmark", doc)).toBeNull();
});
