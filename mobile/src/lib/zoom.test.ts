import { clampPan, clampScale, isZoomed, MAX_ZOOM, panLimits, pinchScale, settleZoom, touchDistance, ZOOM_RESET } from "./zoom";

// Galerie-Zoom (#999): Zwei-Finger-Zoom zwischen 1 und 4, Verschieben nur so weit, wie das Bild reicht, und beim
// Loslassen fast ohne Zoom zurück auf 1.

test("Vergrößerung bleibt zwischen 1 und 4", () => {
  expect(clampScale(0.4)).toBe(1);
  expect(clampScale(2.5)).toBe(2.5);
  expect(clampScale(9)).toBe(MAX_ZOOM);
  expect(clampScale(Number.NaN)).toBe(1);
});

test("Zwei Finger auseinander vergrößern, zusammen verkleinern - ausgehend vom Stand davor", () => {
  const a = { pageX: 100, pageY: 100 };
  const b = { pageX: 200, pageY: 100 };
  expect(touchDistance(a, b)).toBe(100);
  expect(pinchScale(1, 100, 200)).toBe(2);
  expect(pinchScale(2, 100, 150)).toBe(3);
  expect(pinchScale(2, 100, 25)).toBe(1);
  expect(pinchScale(3, 100, 400)).toBe(MAX_ZOOM);
  expect(pinchScale(2, 0, 100)).toBe(2);
});

test("Verschieben reicht genau bis zum Bildrand", () => {
  expect(panLimits(1, 390, 800)).toEqual({ x: 0, y: 0 });
  expect(panLimits(2, 390, 800)).toEqual({ x: 195, y: 400 });
  expect(clampPan({ scale: 2, x: 500, y: -900 }, 390, 800)).toEqual({ scale: 2, x: 195, y: -400 });
  expect(clampPan({ scale: 1, x: 40, y: 40 }, 390, 800)).toEqual({ scale: 1, x: 0, y: 0 });
});

test("beim Loslassen: fast nicht gezoomt springt zurück, sonst bleibt der Zoom in den Grenzen", () => {
  expect(settleZoom({ scale: 1.02, x: 30, y: 10 }, 390, 800)).toEqual(ZOOM_RESET);
  expect(settleZoom({ scale: 2, x: 300, y: 0 }, 390, 800)).toEqual({ scale: 2, x: 195, y: 0 });
  expect(isZoomed({ scale: 1.02, x: 0, y: 0 })).toBe(false);
  expect(isZoomed({ scale: 1.5, x: 0, y: 0 })).toBe(true);
});
