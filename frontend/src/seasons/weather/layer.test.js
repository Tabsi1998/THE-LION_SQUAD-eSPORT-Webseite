import { MAX_SPLASHES, createRainLayer, measureEdges } from "./layer";

// Die Regen-Ebene (#673): Tropfen nach Budget und Regenmenge, Wind und Menge vom Wetter-Ereignis, nachlassender Regen
// läuft aus, Scrollen schiebt die Tropfen mit der Seite, Tropfen landen auf Kanten mit Spritzern, Aufräumen.

function fakeContext(calls) {
  return new Proxy({}, {
    get: (_target, name) => {
      if (["fillStyle", "strokeStyle", "lineWidth", "lineCap", "globalAlpha"].includes(name)) return "";
      return () => {
        calls.push(name);
      };
    },
    set: () => true,
  });
}

function fakeWindow(extra = {}) {
  const listeners = new Map();
  return {
    listeners,
    scrollY: 0,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    emit: (name, detail) => listeners.get(name)?.({ detail }),
    ...extra,
  };
}

function box(element, rect) {
  element.getBoundingClientRect = () => ({ ...rect, width: rect.right - rect.left, height: rect.bottom - rect.top });
}

const SIZE = { width: 1000, height: 600 };

afterEach(() => {
  document.body.innerHTML = "";
});

test("Tropfen nach Budget und Menge; das Wetter ändert Menge und Wind; hört der Regen auf, läuft er aus; Aufräumen", () => {
  const win = fakeWindow();
  const layer = createRainLayer({ budget: 50, share: 1, seed: "t", weather: { rain_mm: 2.5, wind_factor: 0.8, wind_dir: 270, night: false }, win, measure: () => [], now: () => 0 });
  expect(layer.key).toBe("weather-rain");
  expect(win.listeners.has("tls:season-weather")).toBe(true);
  const calls = [];
  const ctx = fakeContext(calls);
  layer.draw(ctx, 0.016, SIZE);
  let state = layer.state();
  expect(state.factor).toBe(1);
  expect(state.counts.total).toBe(60);
  expect(state.drops.back + state.drops.mid + state.drops.front).toBe(60);
  expect(calls.filter((call) => call === "stroke").length).toBeGreaterThan(30);
  expect(state.wind).toEqual({ factor: 0.8, sign: 1 });
  // Weniger Regen, Wind dreht, Nacht: beim nächsten Zählen fallen die Überzähligen noch zu Ende.
  win.emit("tls:season-weather", { rain_mm: 0.1, wind_factor: 1.2, wind_dir: 90, night: true });
  layer.draw(ctx, 0.016, SIZE);
  state = layer.state();
  expect(state.factor).toBe(0.35);
  expect(state.night).toBe(true);
  expect(state.wind).toEqual({ factor: 1.2, sign: -1 });
  expect(state.counts.total).toBe(17);
  const leaving = Object.values(state.positions).flat().filter((drop) => drop.leaving).length;
  expect(leaving).toBe(60 - 17);
  // Der Regen hört auf: nach zwei Sekunden ist kein Tropfen mehr im Bild.
  win.emit("tls:season-weather", { rain_mm: 0 });
  for (let i = 0; i < 40; i += 1) layer.draw(ctx, 0.05, SIZE);
  state = layer.state();
  expect(state.counts.total).toBe(0);
  expect(state.drops.back + state.drops.mid + state.drops.front).toBe(0);
  layer.dispose();
  expect(win.listeners.has("tls:season-weather")).toBe(false);
});

test("Scrollen schiebt die Tropfen mit der Seite: vorne um den Scrollweg, hinten um 0,55", () => {
  const win = fakeWindow();
  const layer = createRainLayer({ budget: 50, share: 1, seed: "scroll", weather: { rain_mm: 2.5 }, win, measure: () => [], now: () => 0 });
  const ctx = fakeContext([]);
  layer.draw(ctx, 0, SIZE);
  const before = layer.state().positions;
  win.scrollY = 80;
  layer.draw(ctx, 0, SIZE);
  const after = layer.state().positions;
  // Nur Tropfen, die nicht oben hinausgeschoben und neu eingesetzt wurden (die bekommen eine neue Stelle).
  const moved = (depth) => before[depth].filter((drop, index) => drop.x === after[depth][index].x).map((drop) => drop.y - after[depth][before[depth].indexOf(drop)].y);
  expect(moved("front").length).toBeGreaterThan(0);
  moved("front").forEach((delta) => expect(delta).toBeCloseTo(80, 5));
  moved("back").forEach((delta) => expect(delta).toBeCloseTo(44, 5));
  layer.dispose();
});

test("Tropfen landen auf Kanten: Spritzer entstehen dort, höchstens eine Handvoll zugleich; Kanten aus der Seite ohne Ruhezonen", () => {
  const win = fakeWindow();
  const edges = [{ x1: -200, x2: 1400, y: 300, key: "card:1" }];
  const layer = createRainLayer({ budget: 120, share: 1, seed: "edge", weather: { rain_mm: 5 }, win, measure: () => edges, now: () => 0 });
  const calls = [];
  const ctx = fakeContext(calls);
  for (let i = 0; i < 30; i += 1) layer.draw(ctx, 0.03, SIZE);
  const state = layer.state();
  expect(state.edges).toEqual(edges);
  expect(state.splashes).toBeGreaterThan(0);
  expect(state.splashes).toBeLessThanOrEqual(MAX_SPLASHES);
  expect(calls.filter((call) => call === "arc").length).toBeGreaterThan(0);
  layer.dispose();
  // Kanten der Seite: Karten, Rahmen, Fußzeile im Fenster - nicht im Formular.
  document.body.innerHTML = `<main><a id="c1" data-season-anchor="card">Eins</a><form id="f"><a id="c2" data-season-anchor="card">Zwei</a></form><a id="far" data-season-anchor="card">Drei</a></main><footer id="foot">Fuß</footer>`;
  box(document.getElementById("c1"), { left: 40, right: 400, top: 100, bottom: 300 });
  box(document.getElementById("f"), { left: 0, right: 1000, top: 320, bottom: 420 });
  box(document.getElementById("c2"), { left: 40, right: 400, top: 330, bottom: 410 });
  box(document.getElementById("far"), { left: 40, right: 400, top: 2000, bottom: 2200 });
  box(document.getElementById("foot"), { left: 0, right: 1000, top: 500, bottom: 700 });
  const measured = measureEdges(document, { scrollX: 0, scrollY: 0, innerWidth: 1000, innerHeight: 600 });
  expect(measured.map((edge) => [edge.x1, edge.x2, edge.y])).toEqual([[46, 394, 100], [6, 994, 500]]);
  expect(measureEdges(null)).toEqual([]);
});

test("Regen an der gehobenen Kante (#1094): ein paar Spritzer nur beim Regen, einmal je Karte in zehn Sekunden", () => {
  let now = 0;
  const layer = createRainLayer({ budget: 50, share: 1, seed: "lift", weather: { rain_mm: 2.5 }, win: fakeWindow(), measure: () => [], now: () => now, signal: null });
  layer.draw(fakeContext([]), 0.016, SIZE);
  const before = layer.state().splashes;
  const lift = { type: "lift", key: "card:1", rect: { left: 100, right: 400, top: 300 } };
  layer.card(lift);
  const after = layer.state().splashes;
  expect(after - before).toBeGreaterThanOrEqual(4);
  expect(after - before).toBeLessThanOrEqual(7);
  layer.card(lift);
  expect(layer.state().splashes).toBe(after);
  now += 10001;
  layer.card(lift);
  expect(layer.state().splashes).toBeGreaterThan(after);

  const dry = createRainLayer({ budget: 50, share: 1, seed: "dry", weather: { rain_mm: 0 }, win: fakeWindow(), measure: () => [], now: () => 0, signal: null });
  dry.card(lift);
  expect(dry.state().splashes).toBe(0);
});
