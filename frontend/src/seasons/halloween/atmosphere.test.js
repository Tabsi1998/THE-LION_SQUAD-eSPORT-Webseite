import { chooseSpot, edgeFree, fogStrength, freeSpots, luminance, spotFree } from "./atmosphere";

// Atmosphäre (H14) und Beobachter (H15): Nebelstärke nach Scrollstand; freie dunkle Flächen über Raster und Sonde,
// Ruhezonen tabu; die beste Zelle hat freie Nachbarn und liegt gern am Rand; Randspalte frei oder nicht.

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

afterEach(() => {
  document.body.innerHTML = "";
});

test("Nebel: voll am Anfang und am Ende der Seite, leise dazwischen", () => {
  expect(fogStrength({ scrollY: 0, innerHeight: 800, scrollHeight: 4000 })).toBe(1);
  expect(fogStrength({ scrollY: 1800, innerHeight: 800, scrollHeight: 4000 })).toBe(0.35);
  expect(fogStrength({ scrollY: 3200, innerHeight: 800, scrollHeight: 4000 })).toBe(1);
  const half = fogStrength({ scrollY: 360, innerHeight: 800, scrollHeight: 4000 });
  expect(half).toBeGreaterThan(0.35);
  expect(half).toBeLessThan(1);
  expect(fogStrength()).toBeGreaterThanOrEqual(0.35);
});

test("Helligkeit einer Farbe: dunkel, hell, durchsichtig, unbekannt", () => {
  expect(luminance("rgb(10, 10, 10)")).toBeLessThan(0.1);
  expect(luminance("rgb(240, 240, 240)")).toBeGreaterThan(0.9);
  expect(luminance("rgba(0, 0, 0, 0)")).toBeNull();
  expect(luminance("transparent")).toBeNull();
  expect(luminance("")).toBeNull();
});

test("freie Fläche: ohne Sonde alles, mit Sonde nichts über Text, Bild, Karte, hellem Grund oder Hintergrundbild - ein Muster auf Vorfahren stört nicht", () => {
  document.body.innerHTML = '<main id="m"><div id="bare"></div><p id="text">Hallo</p><div id="withtext">Text<div id="child"></div></div><a id="card" data-season-anchor="card"><div id="inner"></div></a><div id="light"></div><div id="pic"></div><section id="grid"><div id="ongrid"></div></section></main>';
  const styles = { light: { backgroundColor: "rgb(230, 230, 230)", backgroundImage: "none" }, pic: { backgroundColor: "rgba(0,0,0,0)", backgroundImage: "url(x.png)" }, grid: { backgroundColor: "rgba(0,0,0,0)", backgroundImage: "url(grid.svg)" } };
  const win = { getComputedStyle: (el) => styles[el.id] || { backgroundColor: "rgba(0, 0, 0, 0)", backgroundImage: "none" } };
  const probe = (x) => document.getElementById(["bare", "text", "child", "inner", "light", "pic", "m", "ongrid"][x]);
  expect(spotFree(null, 0, 0)).toBe(true);
  expect(spotFree(probe, 0, 0, win)).toBe(true);
  expect(spotFree(probe, 1, 0, win)).toBe(false);
  expect(spotFree(probe, 2, 0, win)).toBe(false);
  expect(spotFree(probe, 3, 0, win)).toBe(false);
  expect(spotFree(probe, 4, 0, win)).toBe(false);
  expect(spotFree(probe, 5, 0, win)).toBe(false);
  expect(spotFree(probe, 6, 0, win)).toBe(true);
  expect(spotFree(probe, 7, 0, win)).toBe(true);
  expect(spotFree(() => null, 0, 0, win)).toBe(false);
});

test("Raster: Zellen außerhalb von Ruhezonen und Sonden-Treffern, Punkte nach freien Nachbarn und Rand; Auswahl bevorzugt volle Nachbarschaft", () => {
  document.body.innerHTML = '<form id="f"></form><main id="m"><p id="t">Text</p></main>';
  box(document.getElementById("f"), { left: 0, right: 400, top: 100, bottom: 400 });
  const win = { innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0 };
  // Text nur rechts oben, sonst freier Grund.
  const probe = (x, y) => (x > 900 && y < 300 ? document.getElementById("t") : document.getElementById("m"));
  const spots = freeSpots(document, win, { probe });
  expect(spots.length).toBeGreaterThan(20);
  expect(spots.every((spot) => !(spot.x < 420 && spot.y < 420))).toBe(true);
  expect(spots.every((spot) => !(spot.x > 900 && spot.y < 300))).toBe(true);
  expect(spots[0].score).toBeGreaterThanOrEqual(spots[spots.length - 1].score);
  const chosen = chooseSpot(spots, () => 0);
  expect(chosen.score).toBeGreaterThanOrEqual(8);
  expect(chosen.edge).toBe(true);
  expect(chooseSpot([{ score: 3 }], () => 0)).toBeNull();
  expect(chooseSpot([{ score: 6, x: 1 }], () => 0)).toEqual({ score: 6, x: 1 });
  // Ganz ohne Sonde (Tests): nur die Ruhezone zählt.
  expect(freeSpots(document, win, { probe: null }).every((spot) => !(spot.x < 420 && spot.y < 420))).toBe(true);
  // Winziges Fenster: keine Zellen, keine Auswahl.
  expect(freeSpots(document, { innerWidth: 100, innerHeight: 100 }, { probe: null })).toEqual([]);
});

test("Randspalte: frei, wenn alle vier Punkte frei sind - Ruhezone oder Inhalt am Rand sperren", () => {
  document.body.innerHTML = '<main id="m"><p id="t">Text</p></main><div id="quiet" data-season-quiet></div>';
  box(document.getElementById("quiet"), { left: 1200, right: 1280, top: 0, bottom: 800 });
  const win = { innerWidth: 1280, innerHeight: 800, scrollX: 0, scrollY: 0 };
  expect(edgeFree(document, win, "left", { probe: () => document.getElementById("m") })).toBe(true);
  expect(edgeFree(document, win, "right", { probe: () => document.getElementById("m") })).toBe(false);
  expect(edgeFree(document, win, "left", { probe: (x, y) => (y > 600 ? document.getElementById("t") : document.getElementById("m")) })).toBe(false);
});
