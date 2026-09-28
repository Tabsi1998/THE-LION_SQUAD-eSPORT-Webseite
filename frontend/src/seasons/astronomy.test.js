import { moonCoords, moonPosition, nextMoonEvent, skyPlacement, toDays } from "./astronomy";

// Himmel nach Uhrzeit und Ort (#681): Innsbruck (47,27° N, 11,40° O). Der Vollmond vom 26.10.2026 steht um die
// Mitternacht hoch im Süden und ist mittags unter dem Horizont; die Bahn wandert nach Westen; Auf- und Untergang
// wechseln binnen eines Tages; die Kuppel bildet den Stand auf die Seite ab.

const INNSBRUCK = { lat: 47.27, lon: 11.4 };

test("Tage seit J2000 und die Mondkoordinaten sind stetig", () => {
  expect(toDays(new Date(Date.UTC(2000, 0, 1, 12)))).toBeCloseTo(0, 6);
  expect(toDays(new Date(Date.UTC(2000, 0, 2, 12)))).toBeCloseTo(1, 6);
  const a = moonCoords(9800);
  const b = moonCoords(9800.01);
  expect(Math.abs(a.dec - b.dec)).toBeLessThan(0.01);
  expect(a.dist).toBeGreaterThan(356000);
  expect(a.dist).toBeLessThan(407000);
});

test("Vollmond 26.10.2026 über Innsbruck: um Mitternacht hoch im Süden, mittags unter dem Horizont", () => {
  const midnight = moonPosition(new Date("2026-10-26T23:30:00Z"), INNSBRUCK.lat, INNSBRUCK.lon);
  expect(midnight.altitude).toBeGreaterThan(40);
  expect(midnight.altitude).toBeLessThan(70);
  expect(midnight.azimuth).toBeGreaterThan(150);
  expect(midnight.azimuth).toBeLessThan(215);
  const noon = moonPosition(new Date("2026-10-26T11:00:00Z"), INNSBRUCK.lat, INNSBRUCK.lon);
  expect(noon.altitude).toBeLessThan(0);
});

test("die Bahn wandert nach Westen: der Azimut wächst von Stunde zu Stunde, die Höhe ist am Südmeridian am größten", () => {
  const at = (hour) => moonPosition(new Date(Date.UTC(2026, 9, 26, hour)), INNSBRUCK.lat, INNSBRUCK.lon);
  expect(at(19).azimuth).toBeLessThan(at(21).azimuth);
  expect(at(21).azimuth).toBeLessThan(at(23).azimuth);
  expect(at(19).altitude).toBeLessThan(at(23).altitude);
});

test("Auf- und Untergang: binnen 26 Stunden wechselt der Mond die Seite des Horizonts, in beide Richtungen", () => {
  const first = nextMoonEvent(new Date("2026-10-26T11:00:00Z"), INNSBRUCK.lat, INNSBRUCK.lon);
  expect(first).not.toBeNull();
  expect(first.rising).toBe(true);
  expect(first.at.getTime()).toBeGreaterThan(Date.parse("2026-10-26T11:00:00Z"));
  const second = nextMoonEvent(first.at, INNSBRUCK.lat, INNSBRUCK.lon);
  expect(second.rising).toBe(false);
  expect(second.at.getTime() - first.at.getTime()).toBeGreaterThan(8 * 3600000);
  expect(second.at.getTime() - first.at.getTime()).toBeLessThan(16 * 3600000);
});

test("Kuppel: Osten links, Süden Mitte, Westen rechts; Horizont unten, 60° oben; nahe dem Horizont größer und wärmer; unter dem Horizont unsichtbar", () => {
  const view = { width: 1000, height: 800 };
  const east = skyPlacement({ altitude: 5, azimuth: 90 }, view);
  const south = skyPlacement({ altitude: 60, azimuth: 180 }, view);
  const west = skyPlacement({ altitude: 20, azimuth: 270 }, view);
  expect(east.x).toBeLessThan(south.x);
  expect(south.x).toBeCloseTo(500, 5);
  expect(west.x).toBeGreaterThan(south.x);
  expect(east.y).toBeGreaterThan(south.y);
  expect(south.y).toBeCloseTo(800 * 0.12, 5);
  expect(skyPlacement({ altitude: 0, azimuth: 180 }, view).y).toBeCloseTo(800 * 0.86, 5);
  expect(east.scale).toBeGreaterThan(south.scale);
  expect(east.warmth).toBeGreaterThan(0.7);
  expect(south.warmth).toBe(0);
  expect(skyPlacement({ altitude: -5, azimuth: 100 }, view).visible).toBe(false);
  expect(skyPlacement({ altitude: 20, azimuth: 20 }, view).x).toBeCloseTo(1000 * 0.06, 5);
});
