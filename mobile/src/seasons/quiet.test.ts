import { anyOverlayOpen, pointInQuiet, quietSnapshot, quietZones, rectInQuiet, resetQuiet, setOverlay, setQuietZone, subscribeQuiet } from "./quiet";

// Ruhezonen (A3): Dialoge melden sich an und ab, Bereiche melden Rechtecke; Punkte und Rechtecke werden dagegen geprüft.

beforeEach(() => resetQuiet());

test("Overlays: an und ab, doppelt zählt nicht, Abo meldet nur echte Änderungen", () => {
  const seen: number[] = [];
  const stop = subscribeQuiet((state) => seen.push(state.overlays.length));
  setOverlay("sheet", true);
  setOverlay("sheet", true);
  expect(anyOverlayOpen()).toBe(true);
  setOverlay("modal", true);
  setOverlay("sheet", false);
  setOverlay("sheet", false);
  expect(quietSnapshot().overlays).toEqual(["modal"]);
  setOverlay("modal", false);
  expect(anyOverlayOpen()).toBe(false);
  expect(seen).toEqual([1, 2, 1, 0]);
  stop();
});

test("Zonen: Rechtecke mit Rand, Punkt und Rechteck dagegen, Rücknahme", () => {
  setQuietZone("form", { x: 20, y: 300, width: 300, height: 200 });
  setQuietZone("table", { x: 0, y: 600, width: 360, height: 100 });
  expect(quietZones().length).toBe(2);
  expect(pointInQuiet({ x: 100, y: 400 })).toBe(true);
  expect(pointInQuiet({ x: 100, y: 295 })).toBe(true);
  expect(pointInQuiet({ x: 100, y: 280 })).toBe(false);
  expect(rectInQuiet({ x: 0, y: 250, width: 30, height: 60 })).toBe(true);
  expect(rectInQuiet({ x: 0, y: 250, width: 30, height: 40 })).toBe(false);
  setQuietZone("form", null);
  setQuietZone("form", null);
  expect(quietZones().length).toBe(1);
  expect(pointInQuiet({ x: 100, y: 400 })).toBe(false);
});
