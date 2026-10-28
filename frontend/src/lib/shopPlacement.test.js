import { placeMotif, resolveLayers } from "./shopLayout";
import {
  alignToLayer, centerOnArea, clampOffsets, cmToScreen, followersOf, formatCm, frameCm, mirrorOnArea, nextZoom, offsetsForPosition, parseCm,
  positionCm, screenToCm, snapDrag, snapLines, wheelZoom,
} from "./shopPlacement";

// Synthetische Fläche wie in shopLayout.test.js: 1800 × 2400 px bei 150 DPI = 30,48 × 40,64 cm.
const SHIRT = { placement: "front", family: "front", width_px: 1800, height_px: 2400, dpi: 150 };
const CHEST_RIGHT = { key: "chest_right", kind: "motif", center_x: 0.27, anchor: "top", top_cm: 5, width_cm: 8.9 };
const OPPOSITE = { key: "text_opposite", kind: "text", follow: "opposite", center_x: 0.5, anchor: "top", top_cm: 0 };
const PRESETS = [CHEST_RIGHT, OPPOSITE];
const CANVAS = { width_in: 3.5, height_in: 0.75 };
const WIDTH = 30.48;

function resolve(layers) {
  return resolveLayers(SHIRT, layers, { presets: PRESETS, motifFor: () => ({ width_px: 1000, height_px: 1000 }), gamertagCanvas: CANVAS, rules: {} });
}

const LION = { kind: "motif", preset: "chest_right", width_cm: 8.9, offset_x_cm: 0, offset_y_cm: 0, motif: { key: "loewe" } };
const NAME = { kind: "gamertag", preset: "text_opposite", offset_x_cm: 0, offset_y_cm: 0 };

test("Eingabe mit Komma, Punkt und Minus - Unsinn ist keine Zahl", () => {
  expect(parseCm("5,25")).toBe(5.25);
  expect(parseCm(" 5.5 ")).toBe(5.5);
  expect(parseCm("-1,5")).toBe(-1.5);
  expect(parseCm("−2")).toBe(-2);
  expect(parseCm(",5")).toBe(0.5);
  expect(parseCm("0")).toBe(0);
  for (const bad of ["", "-", ",", "5,2,1", "abc", "1e3", null]) expect(parseCm(bad)).toBeNull();
  expect(formatCm(5.25)).toBe("5,25");
  expect(formatCm(-0.001)).toBe("0");
  expect(formatCm(3)).toBe("3");
});

test("Umrechnung Bildschirm ↔ cm: beim Zoom ist ein Pixel weniger cm", () => {
  // 300 px Vorschau für 30,48 cm: ein Pixel ≈ 1 mm; bei 4-fachem Zoom (1200 px) ein Viertel davon.
  expect(screenToCm(10, 300, WIDTH)).toBeCloseTo(1.016, 3);
  expect(screenToCm(10, 1200, WIDTH)).toBeCloseTo(0.254, 3);
  expect(cmToScreen(screenToCm(37, 1200, WIDTH), 1200, WIDTH)).toBeCloseTo(37);
  expect(screenToCm(10, 0, WIDTH)).toBe(0);
  expect(nextZoom(1, 1)).toBe(1.25);
  expect(nextZoom(1.25, -1)).toBe(1);
  expect(nextZoom(8, 1)).toBe(8);
  expect(nextZoom(1, -1)).toBe(1);
});

test("Position in cm und zurück auf den Versatz - die Vorgabe bleibt, die Lage stimmt auf 0,01 cm", () => {
  const [lion] = resolve([LION]);
  const now = positionCm(SHIRT, lion, "center");
  // Brust rechts: Mitte bei 27 % der Breite, Oberkante 5 cm.
  expect(now.y).toBeCloseTo(5, 5);
  expect(now.x).toBeCloseTo(0.27 * WIDTH - WIDTH / 2, 5);
  const patch = offsetsForPosition(SHIRT, lion, LION, { x: -6, y: 7.5 }, "center");
  expect(patch).toEqual({ offset_x_cm: round(-6 - now.x), offset_y_cm: 2.5 });
  const [moved] = resolve([{ ...LION, ...patch }]);
  expect(positionCm(SHIRT, moved, "center").x).toBeCloseTo(-6, 2);
  expect(positionCm(SHIRT, moved, "center").y).toBeCloseTo(7.5, 2);
  // Gemessen vom linken Rand: die linke Kante.
  const left = offsetsForPosition(SHIRT, lion, LION, { x: 3 }, "left");
  expect(left.offset_y_cm).toBeUndefined();
  expect(positionCm(SHIRT, resolve([{ ...LION, ...left }])[0], "left").x).toBeCloseTo(3, 2);
});

function round(value) {
  return Math.round(value * 100) / 100;
}

function onGrid(value, grid) {
  return Math.abs(value / grid - Math.round(value / grid)) < 1e-6;
}

test("Ausrichten: mittig, gespiegelt zur Gegenseite und an einem anderen Motiv", () => {
  const layers = [LION, { ...NAME, offset_y_cm: 3 }];
  const [lion, name] = resolve(layers);
  const centered = resolve([{ ...LION, ...centerOnArea(SHIRT, lion, LION) }])[0];
  expect(frameCm(SHIRT, centered).centerX).toBeCloseTo(WIDTH / 2, 2);
  const mirrored = resolve([{ ...LION, ...mirrorOnArea(SHIRT, lion, LION) }])[0];
  expect(frameCm(SHIRT, mirrored).centerX).toBeCloseTo(WIDTH - frameCm(SHIRT, lion).centerX, 2);
  // Gamertag auf Höhe des Löwen: gleiche senkrechte Mitte; gleiche Oberkante; gegenüber.
  for (const [how, check] of [["middle", (own, ref) => [own.middle, ref.middle]], ["top", (own, ref) => [own.top, ref.top]],
    ["opposite", (own, ref) => [own.centerX + ref.centerX, WIDTH]], ["center", (own, ref) => [own.centerX, ref.centerX]]]) {
    const patch = alignToLayer(SHIRT, name, layers[1], lion, how);
    const after = resolve([LION, { ...layers[1], ...patch }]);
    const [a, b] = check(frameCm(SHIRT, after[1]), frameCm(SHIRT, after[0]));
    expect(a, how).toBeCloseTo(b, 2);
  }
  expect(alignToLayer(SHIRT, name, layers[1], lion, "unbekannt")).toBeNull();
});

test("wer mitwandert, ist kein Ziel: der Name gegenüber folgt dem Löwen", () => {
  expect(followersOf(resolve, [LION, NAME], 0)).toEqual([1]);
  expect(followersOf(resolve, [LION, NAME], 1)).toEqual([]);
});

test("Einrasten an der Mittellinie, an anderen Ebenen und sonst aufs Raster - mit Alt frei", () => {
  const [lion, name] = resolve([LION, NAME]);
  const frame = frameCm(SHIRT, lion);
  const lines = snapLines(SHIRT, [lion, name], { skip: [0, 1] });
  // Die Mitte des Löwen 0,1 cm neben der Flächenmitte: rastet bei 0,3 cm Toleranz ein, die Linie wird gezeigt.
  const toCenter = WIDTH / 2 - frame.centerX;
  const snapped = snapDrag({ frame, dx: toCenter + 0.1, dy: 0, lines, toleranceCm: 0.3, gridCm: 0.5, areaWidthCm: WIDTH });
  expect(frame.centerX + snapped.dx).toBeCloseTo(WIDTH / 2, 6);
  expect(snapped.guides).toEqual([{ axis: "x", at: WIDTH / 2, kind: "center" }]);
  // Mit Alt (frei): genau wie gezogen.
  expect(snapDrag({ frame, dx: toCenter + 0.1, dy: 0.37, lines, toleranceCm: 0.3, gridCm: 0.5, areaWidthCm: WIDTH, free: true }))
    .toEqual({ dx: toCenter + 0.1, dy: 0.37, guides: [] });
  // Weit weg von jeder Linie: die Oberkante landet auf dem 0,5-cm-Raster (5 + 1,37 → 6,5), waagrecht ebenso.
  const grid = snapDrag({ frame, dx: 2.2, dy: 1.37, lines, toleranceCm: 0.05, gridCm: 0.5, areaWidthCm: WIDTH });
  expect(frame.top + grid.dy).toBeCloseTo(6.5, 6);
  expect(onGrid(frame.centerX + grid.dx - WIDTH / 2, 0.5)).toBe(true);
  // Raster vom linken Rand gemessen und ohne Raster.
  const left = snapDrag({ frame, dx: 1.3, dy: 0, lines: { x: [], y: [] }, toleranceCm: 0, gridCm: 1, measure: "left", areaWidthCm: WIDTH });
  expect(onGrid(frame.left + left.dx, 1)).toBe(true);
  expect(snapDrag({ frame, dx: 0.3, dy: 0.2, lines: { x: [], y: [] }, toleranceCm: 0, gridCm: 0, areaWidthCm: WIDTH }).dx).toBe(0.3);
  // An der Kante einer anderen Ebene: Oberkante des Löwen an die Oberkante eines zweiten Motivs.
  const other = { index: 2, kind: "motif", box: placeMotif(SHIRT, CHEST_RIGHT, { widthCm: 4, aspect: 1, offsetXCm: 12, offsetYCm: 3 }) };
  const withOther = snapLines(SHIRT, [lion, other], { skip: [0] });
  const top = snapDrag({ frame, dx: 0, dy: 3.08, lines: withOther, toleranceCm: 0.2, gridCm: 0.5, areaWidthCm: WIDTH });
  expect(frame.top + top.dy).toBeCloseTo(frameCm(SHIRT, other).top, 6);
  expect(top.guides[0]).toMatchObject({ axis: "y", kind: "layer", index: 2 });
});

test("waagrecht ziehen lässt ein genau gesetztes „Von oben“ stehen - erst ein Rasterschritt oder eine Hilfslinie bewegt es", () => {
  // Oberkante genau 5,13 cm (per Zahl gesetzt), weit weg von jeder Linie.
  const frame = { left: 3, right: 8, centerX: 5.5, top: 5.13, bottom: 10.13, middle: 7.63 };
  const lines = { x: [], y: [{ at: 20, kind: "center" }] };
  const base = { frame, lines, toleranceCm: 0.3, gridCm: 0.5, areaWidthCm: WIDTH, stillCm: 0.12 };
  // Zittern (unter der Ziehschwelle) und weniger als ein Rasterschritt: senkrecht bleibt alles genau.
  expect(snapDrag({ ...base, dx: 3, dy: 0.08 }).dy).toBe(0);
  expect(snapDrag({ ...base, dx: 3, dy: 0.3 }).dy).toBe(0);
  // Ein ganzer Schritt: aufs Raster (5,13 + 0,6 → 5,5).
  expect(frame.top + snapDrag({ ...base, dx: 3, dy: 0.6 }).dy).toBeCloseTo(5.5, 6);
  // Ohne Raster folgt die Achse frei, aber Zittern unter der Schwelle bleibt still.
  expect(snapDrag({ ...base, gridCm: 0, dx: 3, dy: 0.3 }).dy).toBeCloseTo(0.3, 6);
  expect(snapDrag({ ...base, gridCm: 0, dx: 3, dy: 0.05 }).dy).toBe(0);
  // Eine Hilfslinie fängt auch unter einem Rasterschritt: Mitte 7,63 + 0,2 liegt neben einer Linie bei 7,8.
  const near = snapDrag({ ...base, lines: { x: [], y: [{ at: 7.8, kind: "layer", index: 3 }] }, dx: 0, dy: 0.2 });
  expect(frame.middle + near.dy).toBeCloseTo(7.8, 6);
  expect(near.guides).toEqual([{ axis: "y", at: 7.8, kind: "layer", index: 3 }]);
});

test("Mausrad und Trackpad zoomen höchstens einen Schritt je Raste und je 100 ms", () => {
  const run = (events) => {
    let state = null;
    const steps = [];
    for (const [deltaY, at, mode] of events) {
      const out = wheelZoom(state, deltaY, at, mode);
      state = out.state;
      if (out.direction) steps.push([at, out.direction]);
    }
    return steps;
  };
  // Trackpad: 50 kleine Werte (-4) in 500 ms - zusammen 200, also zwei Schritte statt sofort 800 %.
  expect(run(Array.from({ length: 50 }, (_, at) => [-4, at * 10]))).toHaveLength(2);
  // Ein heftiger Wisch auf einmal: ein Schritt.
  expect(run([[-1000, 0]])).toEqual([[0, 1]]);
  // Mausrad-Rasten: -100 bei 0, 50 und 150 ms - die zweite wartet, die dritte zoomt; nach unten verkleinert.
  expect(run([[-100, 0], [-100, 50], [-100, 150]])).toEqual([[0, 1], [150, 1]]);
  expect(run([[100, 0]])).toEqual([[0, -1]]);
  // Zeilen (Firefox): 3 Zeilen sind 48 px - zwei Rasten ergeben einen Schritt; Richtungswechsel sammelt neu.
  expect(run([[-3, 0, 1], [-3, 10, 1], [3, 200, 1]])).toEqual([]);
  expect(run([[-3, 0, 1], [-4, 10, 1]])).toEqual([[10, 1]]);
});

test("der Versatz bleibt in den Grenzen des Servers (±300 cm), andere Felder unberührt", () => {
  expect(clampOffsets({ offset_x_cm: 412.5, offset_y_cm: -999, width_cm: 9 })).toEqual({ offset_x_cm: 300, offset_y_cm: -300, width_cm: 9 });
  expect(clampOffsets({ offset_y_cm: 12.345 }, 10)).toEqual({ offset_y_cm: 10 });
  expect(clampOffsets({ offset_x_cm: -2.5 })).toEqual({ offset_x_cm: -2.5 });
  expect(clampOffsets({ variant: "light" })).toEqual({ variant: "light" });
  expect(clampOffsets(null)).toBeNull();
});

test("Sicherheitsrand ist eine Hilfslinie", () => {
  const lines = snapLines(SHIRT, [], { marginCm: 2 });
  expect(lines.x.map((line) => line.at)).toEqual(expect.arrayContaining([2, WIDTH - 2]));
  expect(lines.y.filter((line) => line.kind === "margin")).toHaveLength(2);
});
