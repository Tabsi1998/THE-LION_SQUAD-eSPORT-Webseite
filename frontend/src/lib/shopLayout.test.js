import { centerOffsetCm, cmText, gapCm, gapOffsetCm, layerAbove, layersFromSet, maxWidthCm, outside, placeMotif, placeText, resolveLayers, textBoundsCm, textCanvasIn, visualOf } from "./shopLayout";

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

// ---------------------------------------------------------------- Trikot (#2142)

const BACK = { placement: "back", family: "back", width_px: 1800, height_px: 2400, dpi: 150, width_cm: 30.48, height_cm: 40.64 };
const SPORT_CANVAS = {
  width_in: 3.5, height_in: 0.75, text_height_cm: 1.27, font: "rajdhani-700",
  font_metrics: { "rajdhani-700": { name: 1.5, number: 1.02, band_name: 1, band_number: 1 }, saira: { name: 2.3, number: 1.05, band_name: 1, band_number: 1.01 } },
};
const NAME_TOP = { key: "jersey_back_name", kind: "text", center_x: 0.5, anchor: "top", top_cm: 8 };
const NUMBER_BELOW = { key: "jersey_back_number", kind: "text", follow: "stack", gap_cm: 2, center_x: 0.5, anchor: "top", top_cm: 0 };
const CLUB_BOTTOM = { key: "jersey_back_club", kind: "text", center_x: 0.5, anchor: "bottom", top_cm: 8 };

test("je Schrift: Name mit Luft für Akzente, Nummer nur so hoch wie die Ziffern, Kontur oben und unten (#2142)", () => {
  const name = textCanvasIn(SPORT_CANVAS, { kind: "gamertag", font: "saira", text_height_cm: 2.54, max_width_cm: 25.4 });
  expect(name.width).toBeCloseTo(10);
  expect(name.height).toBeCloseTo(2.3);
  expect(name.band).toBeCloseTo(1);
  const number = textCanvasIn(SPORT_CANVAS, { kind: "member_number", font: "saira", text_height_cm: 2.54, outline_cm: 0.254 });
  expect(number.height).toBeCloseTo(1.05 + 0.2);
  expect(textBoundsCm(BACK, {}, SPORT_CANVAS, { kind: "member_number", font: "saira" })).toEqual({ width: 30.48, height: 38.7 });
  expect(textBoundsCm(BACK, { safe_margin_cm: { back: 2 } }, SPORT_CANVAS, { kind: "gamertag" }).width).toBe(26.48);
});

test("Trikot Rücken: die Nummer 2 cm unter den Großbuchstaben des Namens, der Vereinsname unten, alles mittig (#2142)", () => {
  const layers = [
    { kind: "gamertag", preset: "jersey_back_name", text_height_cm: 4, max_width_cm: 28, font: "saira" },
    { kind: "member_number", preset: "jersey_back_number", text_height_cm: 11, max_width_cm: 28, font: "saira" },
    { kind: "text", preset: "jersey_back_club", text: "TESTVEREIN", text_height_cm: 2.5, max_width_cm: 28, font: "saira" },
  ];
  const resolved = resolveLayers(BACK, layers, { presets: [NAME_TOP, NUMBER_BELOW, CLUB_BOTTOM], motifFor: () => null, gamertagCanvas: SPORT_CANVAS, rules: {} });
  const [name, number, club] = resolved;
  expect(name.box.top).toBeCloseTo((8 / 2.54) * 150);
  expect(gapCm(BACK, name, number)).toBeCloseTo(2);
  expect(visualOf(number).bottom).toBeLessThan(visualOf(club).top);
  for (const item of resolved) expect(item.box.left + item.box.width / 2).toBeCloseTo(900);
  expect(layerAbove(resolved, 1)).toBe(name);
  expect(layerAbove(resolved, 2)).toBe(number);
  expect(layerAbove(resolved, 0)).toBeNull();
  // Ohne Ebene davor gibt es kein „darunter“.
  const alone = resolveLayers(BACK, [layers[1]], { presets: [NUMBER_BELOW], motifFor: () => null, gamertagCanvas: SPORT_CANVAS, rules: {} });
  expect(alone[0].problem).toBe("braucht eine Ebene davor auf dieser Fläche");
});

test("Ausrichten: mittig auf Fläche und Abstand zur Ebene darüber setzen nur den Versatz (#2142)", () => {
  const item = { box: { left: 100, top: 900, width: 600, height: 300 }, band: 150 };
  expect(centerOffsetCm(BACK, item, { offset_x_cm: 1 })).toBeCloseTo(1 + ((900 - 400) / 150) * 2.54, 1);
  const above = { box: { left: 600, top: 300, width: 600, height: 300 }, band: 100 };
  const now = gapCm(BACK, above, item);
  expect(now).toBeCloseTo(((975 - 500) / 150) * 2.54);
  expect(gapOffsetCm(BACK, above, item, { offset_y_cm: 0 }, 2)).toBeCloseTo(Math.round((2 - now) * 100) / 100);
  expect(placeText(BACK, NUMBER_BELOW, { widthPx: 100, heightPx: 50, follow: null })).toBeNull();
});

test("eine Vorlage setzt die Ebenen der Fläche; ein Motiv behält das gewählte (#2142)", () => {
  const set = { layers: [{ kind: "motif", preset: "chest_right", width_cm: 8.9 }, { kind: "member_number", preset: "text_opposite", text_height_cm: 6 }] };
  expect(layersFromSet(set, { motifKey: "loewe" })).toEqual([
    { kind: "motif", preset: "chest_right", width_cm: 8.9, offset_x_cm: 0, offset_y_cm: 0, motif: { key: "loewe", by_color: {} } },
    { kind: "member_number", preset: "text_opposite", text_height_cm: 6, offset_x_cm: 0, offset_y_cm: 0 },
  ]);
});

test("Steigung und fester Rest getrennt; die Grenze rechnet die Kontur ein; eine Vorlage wird auf die Fläche gekürzt (Review #2142)", () => {
  const canvas = { ...SPORT_CANVAS, font_metrics: { saira: { name: 2, name_offset: 0.1, number: 1, number_offset: 0.1, band_name: 1, band_number: 1 } } };
  const size = textCanvasIn(canvas, { kind: "gamertag", font: "saira", text_height_cm: 2.54, outline_cm: 0.254 });
  expect(size.height).toBeCloseTo(2 + 0.1 + 0.2);
  // 40,64 cm hoch: ohne Kontur (40,64 - 0,254) / 1, mit 1 cm Kontur 2 cm weniger.
  expect(textBoundsCm(BACK, {}, canvas, { kind: "member_number", font: "saira" }).height).toBeCloseTo(40.38, 1);
  expect(textBoundsCm(BACK, {}, canvas, { kind: "member_number", font: "saira", outline_cm: 1 }).height).toBeCloseTo(38.38, 1);
  const set = { layers: [{ kind: "gamertag", preset: "jersey_back_name", text_height_cm: 7, min_text_height_cm: 2.4, max_width_cm: 45 }] };
  const [name] = layersFromSet(set, { boundsFor: () => ({ width: 30.48, height: 5 }) });
  expect(name).toMatchObject({ max_width_cm: 30.48, text_height_cm: 5, min_text_height_cm: 2.4 });
});