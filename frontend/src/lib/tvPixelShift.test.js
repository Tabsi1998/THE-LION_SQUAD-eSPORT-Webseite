// Pixel-Verschiebung (#1112): unter 4 Punkten, ein Rundgang, Start ohne Versatz.
import { PIXEL_SHIFT_MAX, PIXEL_SHIFT_MS, PIXEL_SHIFT_PATH, pixelShiftAt } from "./tvPixelShift";

test("jede Verschiebung bleibt unter 4 Punkten, jeder Platz kommt einmal dran", () => {
  expect(PIXEL_SHIFT_MAX).toBeLessThan(4);
  for (const [x, y] of PIXEL_SHIFT_PATH) {
    expect(Math.abs(x)).toBeLessThanOrEqual(PIXEL_SHIFT_MAX);
    expect(Math.abs(y)).toBeLessThanOrEqual(PIXEL_SHIFT_MAX);
  }
  expect(new Set(PIXEL_SHIFT_PATH.map((point) => point.join(","))).size).toBe(PIXEL_SHIFT_PATH.length);
  // „Alle paar Minuten“
  expect(PIXEL_SHIFT_MS).toBeGreaterThanOrEqual(60 * 1000);
});

test("beginnt ohne Versatz und läuft im Kreis", () => {
  expect(pixelShiftAt(0)).toEqual([0, 0]);
  expect(pixelShiftAt(PIXEL_SHIFT_PATH.length)).toEqual([0, 0]);
  expect(pixelShiftAt(1)).toEqual(PIXEL_SHIFT_PATH[1]);
  expect(pixelShiftAt(-1)).toEqual(PIXEL_SHIFT_PATH[PIXEL_SHIFT_PATH.length - 1]);
  expect(pixelShiftAt("x")).toEqual([0, 0]);
});
