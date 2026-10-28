import { cmText, maxWidthCm, outside, placeMotif, placeText, resolveLayers, textCanvasIn } from "./shopLayout";

// Dieselben Zahlen wie backend/tests/test_shop_print_templates_unit.py - die Vorschau zeigt, was der Server erzeugt.
const SHIRT = { placement: "front", family: "front", width_px: 1800, height_px: 2400, dpi: 150 };
const CAP = { placement: "front", family: "front", width_px: 1350, height_px: 705, dpi: 300 };
const CHEST_RIGHT = { key: "chest_right", kind: "motif", center_x: 0.27, anchor: "top", top_cm: 5, width_cm: 8.9 };
const CAP_FRONT = { key: "cap_front", kind: "motif", center_x: 0.5, anchor: "middle", top_cm: 0, width_cm: 10 };
const OPPOSITE = { key: "text_opposite", kind: "text", follow: "opposite", center_x: 0.5, anchor: "top", top_cm: 0 };

function rounded(box) {
  const left = Math.round(box.left);
  const top = Math.round(box.top);
  return [left, top, Math.round(box.left + box.width) - left, Math.round(box.top + box.height) - top];
}

test("Brust rechts liegt auf dem Shirt wie beim Server", () => {
  expect(rounded(placeMotif(SHIRT, CHEST_RIGHT, { widthCm: 8.9, aspect: 1 }))).toEqual([223, 295, 526, 526]);
});

test("Kappe vorne: mittig in 1350 × 705 px bei 300 DPI", () => {
  expect(rounded(placeMotif(CAP, CAP_FRONT, { widthCm: 10, aspect: 0.5 }))).toEqual([84, 57, 1182, 591]);
  expect(maxWidthCm(CAP, 0.5, {})).toBe(11.4);
});

test("der Name gegenüber dem Motiv: gespiegelt, senkrecht auf dessen Mitte", () => {
  const lion = placeMotif(SHIRT, CHEST_RIGHT, { widthCm: 8.9, aspect: 1.2 });
  const name = placeText(SHIRT, OPPOSITE, { widthPx: 525, heightPx: 110, follow: lion });
  expect(name.left + name.width / 2).toBeCloseTo(1800 - (lion.left + lion.width / 2));
  expect(name.top + name.height / 2).toBeCloseTo(lion.top + lion.height / 2);
  expect(placeText(SHIRT, OPPOSITE, { widthPx: 525, heightPx: 110, follow: null })).toBeNull();
});

test("Überstand und Sicherheitsrand werden erkannt; cm immer mit Zoll", () => {
  const moved = placeMotif(SHIRT, CHEST_RIGHT, { widthCm: 8.9, aspect: 1, offsetXCm: -10 });
  expect(outside(SHIRT, moved, {})).toEqual(["links"]);
  const margin = { safe_margin_cm: { front: 2 } };
  expect(outside(SHIRT, { left: 50, top: 200, width: 100, height: 100 }, margin)).toEqual(["links"]);
  expect(cmText(20)).toBe("20 cm (7,87 Zoll)");
});

test("alle Ebenen einer Fläche: Motiv zuerst, Name folgt, fehlende Motive werden benannt", () => {
  const layers = [{ kind: "gamertag", preset: "text_opposite" }, { kind: "motif", preset: "chest_right", width_cm: 8.9, motif: { key: "loewe" } }];
  const resolved = resolveLayers(SHIRT, layers, {
    presets: [CHEST_RIGHT, OPPOSITE], motifFor: () => ({ width_px: 1000, height_px: 1000 }),
    gamertagCanvas: { width_in: 3.5, height_in: 0.7 }, rules: {},
  });
  expect(resolved.map((item) => item.kind)).toEqual(["gamertag", "motif"]);
  expect(resolved[0].box.width).toBeCloseTo(525);
  expect(resolved[1].outside).toEqual([]);
  const missing = resolveLayers(SHIRT, [layers[1]], { presets: [CHEST_RIGHT], motifFor: () => null, rules: {} });
  expect(missing[0].problem).toBe("Motiv fehlt");
});

test("die Größe je Namensebene: Höchstbreite ist die Breite, die Höhe wächst mit der Texthöhe (#2105)", () => {
  const canvas = { width_in: 3.5, height_in: 0.75, text_height_cm: 1.27, max_width_cm: 8.89, height_per_text: 1.5 };
  expect(textCanvasIn(canvas, {})).toEqual({ width: 3.5, height: 0.75 });
  const own = textCanvasIn(canvas, { text_height_cm: 2.54, max_width_cm: 5.08 });
  expect(own.width).toBeCloseTo(2);
  expect(own.height).toBeCloseTo(1.5);
  const layers = [{ kind: "motif", preset: "chest_right", width_cm: 8.9 }, { kind: "gamertag", preset: "text_opposite", max_width_cm: 6 }];
  const [, name] = resolveLayers(SHIRT, layers, {
    presets: [CHEST_RIGHT, OPPOSITE], motifFor: () => ({ width_px: 1000, height_px: 1000 }), gamertagCanvas: canvas, rules: {},
  });
  expect(name.box.width).toBeCloseTo((6 / 2.54) * 150);
  expect(name.box.height).toBeCloseTo(0.75 * 150);
});
