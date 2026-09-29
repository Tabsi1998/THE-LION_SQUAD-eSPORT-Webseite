import { SPRITE_RADII, createSnowLayer, drawShape, makeSprites } from "./layer";
import { SHAPES } from "./flakes";

// Die Schnee-Ebene (S7, W2): Formen zeichnen, Sprites nur mit 2D-Fläche, Flocken nach Budget und Wetter, Wind aus dem
// Wetter-Ereignis, Böen ziehen weiter, Aufräumen nimmt den Hörer wieder ab.

function fakeContext(calls) {
  return new Proxy({}, {
    get: (_target, name) => {
      if (["fillStyle", "strokeStyle", "lineWidth", "lineCap", "globalAlpha"].includes(name)) return "";
      if (name === "createRadialGradient") return () => ({ addColorStop: () => calls.push("stop") });
      return (...args) => {
        calls.push(name);
        return args.length ? undefined : undefined;
      };
    },
    set: () => true,
  });
}

function fakeWindow() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener: (name, fn) => listeners.set(name, fn),
    removeEventListener: (name) => listeners.delete(name),
    emit: (name, detail) => listeners.get(name)?.({ detail }),
  };
}

const SIZE = { width: 1000, height: 600 };

test("jede Form lässt sich zeichnen; Sprites nur mit einer 2D-Fläche", () => {
  SHAPES.forEach((shape) => {
    const calls = [];
    drawShape(fakeContext(calls), shape, 4);
    expect(calls.includes("fill") || calls.includes("stroke")).toBe(true);
    expect(calls[0]).toBe("save");
    expect(calls[calls.length - 1]).toBe("restore");
  });
  expect(makeSprites(null)).toBeNull();
  expect(makeSprites({ createElement: () => ({ getContext: () => null }) })).toBeNull();
  const drawn = [];
  const sprites = makeSprites({ createElement: () => ({ getContext: () => fakeContext(drawn) }) }, 2);
  expect(Object.keys(sprites)).toEqual(SHAPES);
  expect(Object.keys(sprites.star).map(Number).sort((a, b) => a - b)).toEqual([...SPRITE_RADII].sort((a, b) => a - b));
  expect(sprites.dot[SPRITE_RADII[0]].canvas.width).toBeGreaterThan(0);
  expect(drawn.filter((call) => call === "setTransform").length).toBe(SHAPES.length * SPRITE_RADII.length);
});

test("Flocken nach Budget und Wetter: es schneit → volle Zahl; Wind vom Wetter-Ereignis; Ausklang; Böen ziehen weiter; Aufräumen", () => {
  const win = fakeWindow();
  const layer = createSnowLayer({ budget: 40, share: 1, seed: "t", weather: { snow_cm: 1.2, wind_factor: 0.8, wind_dir: 270 }, win, doc: null, now: () => 0 });
  expect(layer.key).toBe("snow-flakes");
  expect(win.listeners.has("tls:season-weather")).toBe(true);
  const calls = [];
  const ctx = fakeContext(calls);
  layer.draw(ctx, 0.016, SIZE);
  let state = layer.state();
  expect(state.snowing).toBe(true);
  expect(state.counts.total).toBe(40);
  expect(state.flakes.back + state.flakes.mid + state.flakes.front).toBe(40);
  expect(state.wind).toEqual({ factor: 0.8, sign: 1 });
  expect(calls.filter((call) => call === "translate").length).toBe(40);
  expect(calls.includes("drawImage")).toBe(false);
  // Wetter: Wind dreht, es hört auf zu schneien - beim nächsten Zählen (alle 5 s) werden es weniger.
  win.emit("tls:season-weather", { snow_cm: 0, wind_factor: 1.4, wind_dir: 90 });
  layer.draw(ctx, 0.016, SIZE);
  state = layer.state();
  expect(state.wind).toEqual({ factor: 1.4, sign: -1 });
  expect(state.counts.total).toBe(22);
  expect(state.flakes.back + state.flakes.mid + state.flakes.front).toBe(22);
  // Böen: nach der ersten kommt eine neue.
  const firstGust = state.gust;
  layer.draw(ctx, firstGust.at + firstGust.length + 6, SIZE);
  expect(layer.state().gust.at).toBeGreaterThan(firstGust.at);
  layer.dispose();
  expect(win.listeners.has("tls:season-weather")).toBe(false);
  // Ausklang: eine Minute vor dem Ende nur noch ein Zehntel.
  const late = createSnowLayer({ budget: 100, share: 1, weather: { snow_cm: 1 }, win: fakeWindow(), doc: null, endsAt: "2027-01-06T23:59:59+01:00", now: () => Date.parse("2027-01-06T23:58:59+01:00") });
  late.draw(ctx, 0.016, SIZE);
  expect(late.state().counts.total).toBe(10);
  // Ohne Fenster (SSR, Tests) kein Fehler.
  const bare = createSnowLayer({ budget: 10, win: null, doc: null });
  bare.draw(ctx, 0.016, SIZE);
  bare.dispose();
  expect(bare.state().counts.total).toBe(6);
});

test("Scrollen schiebt die Flocken: vorne so weit wie die Seite, hinten weniger - ohne Scrollen bleiben sie stehen", () => {
  const win = { ...fakeWindow(), scrollY: 0 };
  const layer = createSnowLayer({ budget: 40, share: 1, seed: "scroll", weather: { snow_cm: 1 }, win, doc: null, now: () => 0 });
  const ctx = fakeContext([]);
  layer.draw(ctx, 0, SIZE);
  const before = layer.state().positions;
  layer.draw(ctx, 0, SIZE);
  expect(layer.state().positions).toEqual(before);
  win.scrollY = 60;
  layer.draw(ctx, 0, SIZE);
  const after = layer.state().positions;
  const moved = (depth) => before[depth].map((flake, index) => flake.y - after[depth][index].y).filter((delta) => Math.abs(delta) < 200);
  expect(moved("front").length).toBeGreaterThan(0);
  moved("front").forEach((delta) => expect(delta).toBeCloseTo(60, 5));
  moved("back").forEach((delta) => expect(delta).toBeCloseTo(33, 5));
  // Zurück nach oben: sie kommen wieder herunter.
  win.scrollY = 0;
  layer.draw(ctx, 0, SIZE);
  const back = layer.state().positions;
  const returned = after.front.map((flake, index) => back.front[index].y - flake.y).filter((delta) => Math.abs(delta) < 200);
  returned.forEach((delta) => expect(delta).toBeCloseTo(60, 5));
  layer.dispose();
});

test("Regen wird im Winter zu Schnee: regnet es draußen, schneit es auf der Seite dichter - starker Regen am dichtesten", () => {
  const win = fakeWindow();
  const layer = createSnowLayer({ budget: 40, share: 1, seed: "rain", weather: { snow_cm: 0, rain_mm: 0 }, win, doc: null, now: () => 0 });
  const ctx = fakeContext([]);
  layer.draw(ctx, 0.016, SIZE);
  expect(layer.state()).toMatchObject({ snowing: false, factor: 0.55 });
  expect(layer.state().counts.total).toBe(22);
  win.emit("tls:season-weather", { snow_cm: 0, rain_mm: 0.8 });
  layer.draw(ctx, 0.016, SIZE);
  expect(layer.state()).toMatchObject({ snowing: true, factor: 1 });
  expect(layer.state().counts.total).toBe(40);
  win.emit("tls:season-weather", { snow_cm: 0.4, rain_mm: 3 });
  layer.draw(ctx, 0.016, SIZE);
  expect(layer.state().factor).toBe(1.25);
  expect(layer.state().counts.total).toBe(50);
  layer.dispose();
});
