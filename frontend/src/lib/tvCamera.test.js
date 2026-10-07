// Kamera über dem Turnierbaum (#1115): Rechnung „passt oder Kamera“ und die Reihenfolge der Kamera-Halte - die laufende
// Runde bleibt am längsten im Bild, neue Daten lassen die Kamera nicht springen.
import { CAMERA, cameraStops, centeredView, clampView, fitZoom, nearestStop, rectFits, stageTransform, unionRect, viewBetween, viewForRect } from "./tvCamera";
import { treeMinZoom } from "./tvType";

const VIEWPORT = { w: 1858, h: 734 };

test("passt der Baum so, dass Namen die Untergrenze halten, steht er still - sonst kommt die Kamera", () => {
  const minZoom = treeMinZoom("normal");
  // Ein kleiner Baum wird etwas größer, aber nie riesig.
  expect(fitZoom({ w: 900, h: 500 }, VIEWPORT, { minZoom })).toEqual({ fits: true, zoom: CAMERA.maxZoom });
  // Etwas zu groß: er darf bis zur Untergrenze kleiner werden und steht still.
  const snug = fitZoom({ w: 2000, h: 800 }, VIEWPORT, { minZoom });
  expect(snug.fits).toBe(true);
  expect(snug.zoom).toBeCloseTo(0.9175, 3);
  // Viel zu groß: verkleinert wären die Namen zu klein - also Kamera.
  const big = fitZoom({ w: 3600, h: 2400 }, VIEWPORT, { minZoom });
  expect(big.fits).toBe(false);
  expect(big.zoom).toBeLessThan(minZoom);
  // „Groß“ verträgt weniger Verkleinern.
  expect(fitZoom({ w: 2000, h: 900 }, VIEWPORT, { minZoom: treeMinZoom("large") }).fits).toBe(false);
  expect(fitZoom({ w: 2000, h: 900 }, VIEWPORT, { minZoom: treeMinZoom("normal") }).fits).toBe(true);
});

test("Kamera-Halte in Schlangenlinie, leere Ausschnitte fallen weg, die laufende Runde bleibt am längsten", () => {
  const content = { w: 3000, h: 2000 };
  const boxes = [];
  for (let x = 0; x < 3000; x += 400) for (let y = 0; y < 2000; y += 180) boxes.push({ x, y, w: 380, h: 150 });
  boxes.find((box) => box.x === 2400 && box.y === 900).live = true;
  boxes.filter((box) => box.x === 0).forEach((box) => { box.current = true; });
  const stops = cameraStops({ content, viewport: VIEWPORT, zoom: 1, boxes });
  const at = stops.map((stop) => [Math.round(stop.x), Math.round(stop.y)]);
  // Zwei Spalten, vier Reihen: links → rechts, rechts → links, …
  expect(at).toEqual([[0, 0], [1142, 0], [1142, 422], [0, 422], [0, 844], [1142, 844], [1142, 1266], [0, 1266]]);
  const live = stops.filter((stop) => stop.live);
  expect(live.length).toBeGreaterThan(0);
  const longest = Math.max(...stops.map((stop) => stop.holdMs));
  expect(live.every((stop) => stop.holdMs === longest)).toBe(true);
  expect(stops.filter((stop) => !stop.live && !stop.current).every((stop) => stop.holdMs === CAMERA.holdMs)).toBe(true);
  expect(stops.some((stop) => stop.current && stop.holdMs > CAMERA.holdMs && stop.holdMs < longest)).toBe(true);
  // Ohne Karten unten rechts: dieser Ausschnitt fällt weg.
  const sparse = cameraStops({ content, viewport: VIEWPORT, zoom: 1, boxes: boxes.filter((box) => box.y < 1000) });
  expect(sparse.length).toBeLessThan(stops.length);
  expect(sparse.every((stop) => stop.cards > 0)).toBe(true);
});

test("ein laufendes Spiel steht beim Halt ganz im Bild - der Ausschnitt rückt so wenig wie nötig nach", () => {
  const content = { w: 3000, h: 2000 };
  const live = { x: 300, y: 640, w: 380, h: 150, live: true };
  const boxes = [{ x: 0, y: 0, w: 380, h: 150 }, live, { x: 2500, y: 1800, w: 380, h: 150 }];
  const stops = cameraStops({ content, viewport: VIEWPORT, zoom: 1, boxes });
  const first = stops[0];
  expect(first.live).toBe(true);
  expect(first.y).toBe(790 - 734);
  expect(first.x).toBe(0);
  const frame = { x: first.x, y: first.y, w: VIEWPORT.w, h: VIEWPORT.h };
  expect(live.x >= frame.x && live.y >= frame.y && live.x + live.w <= frame.x + frame.w && live.y + live.h <= frame.y + frame.h).toBe(true);
});

test("ein neuer Stand lässt die Kamera am Platz: der nächste Halt ist der, an dem sie gerade steht", () => {
  const stops = [{ x: 0, y: 0, zoom: 1 }, { x: 1142, y: 0, zoom: 1 }, { x: 1142, y: 422, zoom: 1 }];
  expect(nearestStop(stops, { x: 1100, y: 30, zoom: 1 })).toBe(1);
  expect(nearestStop(stops, { x: 1142, y: 400, zoom: 1 })).toBe(2);
  expect(nearestStop([], { x: 0, y: 0, zoom: 1 })).toBe(0);
});

test("Ausschnitte bleiben im Baum, kleine Bäume stehen mittig, der Zoom beim Start zeigt die Karte groß", () => {
  const content = { w: 3000, h: 2000 };
  expect(clampView({ x: -50, y: 5000, zoom: 1 }, content, VIEWPORT)).toEqual({ x: 0, y: 2000 - 734, zoom: 1 });
  expect(centeredView({ w: 1000, h: 400 }, VIEWPORT, 1)).toEqual({ x: -429, y: -167, zoom: 1 });
  const card = { x: 1200, y: 900, w: 400, h: 160 };
  const view = viewForRect(card, content, VIEWPORT, { minZoom: 0.83 });
  expect(view.zoom).toBeGreaterThan(1);
  expect(rectFits(card, VIEWPORT, view.zoom)).toBe(true);
  // Die Karte liegt mitten im Ausschnitt.
  const centerX = view.x + VIEWPORT.w / view.zoom / 2;
  const centerY = view.y + VIEWPORT.h / view.zoom / 2;
  expect(centerX).toBeCloseTo(1400);
  expect(centerY).toBeCloseTo(980);
  expect(unionRect([card, { x: 1000, y: 1200, w: 100, h: 100 }])).toEqual({ x: 1000, y: 900, w: 600, h: 400 });
  expect(unionRect([])).toBeNull();
});

test("die Fahrt beginnt und endet genau an den Halten, dazwischen ruhig", () => {
  const from = { x: 0, y: 0, zoom: 1 };
  const to = { x: 600, y: 300, zoom: 1.5 };
  expect(viewBetween(from, to, 0, VIEWPORT)).toEqual(from);
  const end = viewBetween(from, to, 1, VIEWPORT);
  expect(end.x).toBeCloseTo(600);
  expect(end.y).toBeCloseTo(300);
  expect(end.zoom).toBeCloseTo(1.5);
  const mid = viewBetween(from, to, 0.5, VIEWPORT);
  expect(mid.zoom).toBeCloseTo(Math.sqrt(1.5));
  expect(stageTransform({ x: 100, y: 50, zoom: 1.5 }, 2)).toBe("translate(-300px, -150px) scale(3)");
});
