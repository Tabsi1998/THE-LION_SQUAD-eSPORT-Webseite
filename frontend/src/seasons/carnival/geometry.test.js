import { HEAD_RANGE, headTop, scanHead, streamerPath, streamerPlan } from "./geometry";

// Wo Hut und Luftschlangen sitzen (Fasching F2 #746, F3 #747): der Scheitel aus dem Bild gelesen (auch für ein
// eigenes Vereinslogo), die Luftschlangen je Seite und Jahr fest, ihre Form oben befestigt und nach unten gekräuselt.

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

test("halb durchsichtige Ränder zählen nicht als Kopf", () => {
  const data = image(20, 20, [[5, 8, 10, 12]]);
  for (let x = 0; x < 20; x += 1) data[(3 * 20 + x) * 4 + 3] = 90;
  expect(scanHead(data, 20, 20, [0, 1]).y).toBe(0.4);
});

test("Scheitel aus einem geladenen Bild - einmal gelesen, danach aus dem Speicher; ohne Canvas nichts", () => {
  const data = image(60, 30, [[20, 6, 30, 20]]);
  const ctx = { drawImage: vi.fn(), getImageData: vi.fn(() => ({ data })) };
  const doc = { createElement: vi.fn(() => ({ getContext: () => ctx })) };
  const img = { currentSrc: "/lion-test.png", naturalWidth: 60, naturalHeight: 30 };
  const first = headTop(img, "mascot", doc);
  expect(first).toEqual({ x: 0.408, y: 0.2 });
  expect(headTop(img, "mascot", doc)).toBe(first);
  expect(doc.createElement).toHaveBeenCalledTimes(1);
  // Fremde Herkunft: der Canvas ist „vergiftet“, das Lesen wirft - dann gilt der Ersatz der Aufrufer.
  const tainted = { createElement: () => ({ getContext: () => ({ drawImage: () => {}, getImageData: () => { throw new Error("tainted"); } }) }) };
  expect(headTop({ src: "https://cdn.example/logo.png", naturalWidth: 60, naturalHeight: 30 }, "wordmark", tainted)).toBeNull();
  expect(headTop({ src: "/not-loaded.png", naturalWidth: 0, naturalHeight: 0 }, "wordmark", doc)).toBeNull();
});

test("Luftschlangen: je Seite ein bis zwei, fest je Jahr und Seite der Webseite, Maße im Rahmen", () => {
  const plan = streamerPlan(2027, "/");
  expect(streamerPlan(2027, "/")).toEqual(plan);
  expect(streamerPlan(2027, "/events")).not.toEqual(plan);
  expect(streamerPlan(2028, "/")).not.toEqual(plan);
  for (const side of ["left", "right"]) {
    const mine = plan.filter((streamer) => streamer.side === side);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.length).toBeLessThanOrEqual(2);
    mine.forEach((streamer, index) => expect(streamer.index).toBe(index));
  }
  for (const streamer of plan) {
    expect(streamer.length).toBeGreaterThanOrEqual(70);
    expect(streamer.length).toBeLessThanOrEqual(150);
    expect(streamer.colors).toHaveLength(2);
    expect(streamer.sway).toBeGreaterThanOrEqual(4.5);
    expect(streamer.sway).toBeLessThanOrEqual(7);
  }
});

test("die Form: oben in der Mitte befestigt, unten so lang wie die Luftschlange, nach unten weiter schwingend", () => {
  const d = streamerPath({ length: 120, curl: 8, turns: 3 });
  expect(d.startsWith("M 12.0 0.0 L ")).toBe(true);
  const points = d.slice(2).split(" L ").map((pair) => pair.split(" ").map(Number));
  expect(points).toHaveLength(33);
  expect(points[32][1]).toBe(120);
  const reach = (from, to) => Math.max(...points.slice(from, to).map(([x]) => Math.abs(x - 12)));
  expect(reach(24, 33)).toBeGreaterThan(reach(0, 9));
  expect(reach(0, 33)).toBeLessThanOrEqual(8);
});
