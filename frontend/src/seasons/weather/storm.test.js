import { BOLT_REACH, FLASH_GAP, FLASH_SECONDS, GLOW_ALPHA, PULSE, boltPath, createFlash, flashDone, flashLevel, isThunderstorm, nextFlashAt } from "./storm";
import { createWeatherLayer } from "./layer";
import { mulberry32 } from "../rng";

// Gewitter (Betreiber 29.09.): nur bei gemeldetem Gewitter, selten (mindestens acht Sekunden Abstand), höchstens zwei
// Pulse je Blitz, leiser Schein im oberen Teil; nicht in der Schnee-Saison; im Bewegungsbudget; die Ebene ruht, wenn
// der nächste Blitz noch fern ist.

const SIZE = { width: 1200, height: 800 };

function fakeContext(calls) {
  return new Proxy({}, {
    get: (_target, name) => {
      if (["fillStyle", "strokeStyle", "lineWidth", "lineCap", "lineJoin", "globalAlpha"].includes(name)) return "";
      if (name === "createRadialGradient") return () => ({ addColorStop: () => calls.push("stop") });
      return () => {
        calls.push(name);
      };
    },
    set: () => true,
  });
}

/** Ein Fenster aus Pappe mit mehreren Hörern je Ereignis (Wetter-Ebene und Regen-Ebene hören beide auf das Wetter). */
function fakeWindow() {
  const listeners = new Set();
  return {
    listeners,
    scrollY: 0,
    addEventListener: (name, fn) => listeners.add(fn),
    removeEventListener: (name, fn) => listeners.delete(fn),
    emit: (name, detail) => [...listeners].forEach((fn) => fn({ detail })),
  };
}

function fakeDocument(season = "weather") {
  return { documentElement: { dataset: { season } }, createElement: () => ({ getContext: () => null }), querySelector: () => ({ getBoundingClientRect: () => ({ top: 0, bottom: 80 }) }) };
}

test("Gewitter nur bei gemeldetem Gewitter und frischem Stand", () => {
  expect(isThunderstorm({ code: 95 })).toBe(true);
  expect(isThunderstorm({ code: 96 })).toBe(true);
  expect(isThunderstorm({ code: 99 })).toBe(true);
  expect(isThunderstorm({ code: 82 })).toBe(false);
  expect(isThunderstorm({ code: 61 })).toBe(false);
  expect(isThunderstorm({ code: null })).toBe(false);
  expect(isThunderstorm({ code: 95, stale: true })).toBe(false);
  expect(isThunderstorm(null)).toBe(false);
});

test("Blitz: selten, kurz, höchstens zwei Pulse, der zweite schwächer; der Schein bleibt leise", () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 20; i += 1) {
    const at = nextFlashAt(rng, 100);
    expect(at).toBeGreaterThanOrEqual(100 + FLASH_GAP[0]);
    expect(at).toBeLessThanOrEqual(100 + FLASH_GAP[1]);
  }
  expect(FLASH_GAP[0]).toBeGreaterThanOrEqual(8);
  expect(FLASH_SECONDS).toBeLessThan(0.5);
  expect(GLOW_ALPHA).toBeLessThanOrEqual(0.14);
  const single = { startedAt: 10, strength: 1, pulses: 1, bolt: null };
  expect(flashLevel(single, 9.9)).toBe(0);
  expect(flashLevel(single, 10 + PULSE.rise)).toBeCloseTo(1, 5);
  expect(flashLevel(single, 10 + PULSE.rise + PULSE.fall / 2)).toBeCloseTo(0.5, 5);
  expect(flashLevel(single, 10 + PULSE.second + PULSE.rise)).toBeLessThan(0.3);
  expect(flashLevel(single, 10 + FLASH_SECONDS + 0.01)).toBe(0);
  const double = { ...single, pulses: 2 };
  expect(flashLevel(double, 10 + PULSE.second + PULSE.rise)).toBeCloseTo(0.6, 5);
  expect(flashDone(double, 10 + FLASH_SECONDS - 0.01)).toBe(false);
  expect(flashDone(double, 10 + FLASH_SECONDS + 0.01)).toBe(true);
  const flashes = Array.from({ length: 40 }, () => createFlash(rng, SIZE, 0));
  expect(flashes.every((flash) => flash.pulses === 1 || flash.pulses === 2)).toBe(true);
  expect(flashes.some((flash) => flash.bolt)).toBe(true);
  expect(flashes.some((flash) => !flash.bolt)).toBe(true);
  flashes.forEach((flash) => {
    expect(flash.strength).toBeGreaterThanOrEqual(0.6);
    expect(flash.strength).toBeLessThanOrEqual(1);
    expect(flash.x).toBeGreaterThan(0);
    expect(flash.x).toBeLessThan(SIZE.width);
  });
});

test("Weg des Blitzes: vom oberen Rand nach unten, nie tiefer als die obere Hälfte, mit ein oder zwei Ästen", () => {
  const rng = mulberry32(11);
  for (let i = 0; i < 20; i += 1) {
    const bolt = boltPath(rng, SIZE);
    expect(bolt.main[0].y).toBe(0);
    const last = bolt.main[bolt.main.length - 1];
    expect(last.y).toBeGreaterThanOrEqual(SIZE.height * BOLT_REACH[0] - 0.001);
    expect(last.y).toBeLessThanOrEqual(SIZE.height * BOLT_REACH[1] + 0.001);
    bolt.main.forEach((point, index) => {
      if (index) expect(point.y).toBeGreaterThan(bolt.main[index - 1].y);
    });
    expect(bolt.branches.length).toBeGreaterThanOrEqual(1);
    expect(bolt.branches.length).toBeLessThanOrEqual(2);
  }
  // Unter der Kopfzeile: der Blitz beginnt dort, wo der Himmel beginnt.
  const below = boltPath(mulberry32(3), SIZE, 80);
  expect(below.main[0].y).toBe(80);
  expect(below.main[below.main.length - 1].y).toBeLessThanOrEqual(80 + SIZE.height * BOLT_REACH[1] + 0.001);
  expect(createFlash(mulberry32(3), SIZE, 5, 80)).toMatchObject({ startedAt: 5, top: 80 });
});

test("Wetter-Ebene: bei Gewitter blitzt es im Budget, mit Abstand; in der Schnee-Saison nie; ohne Gewitter nie", () => {
  const tokens = [];
  const request = vi.fn((kind) => {
    const token = { kind, id: tokens.length + 1 };
    tokens.push(token);
    return token;
  });
  const release = vi.fn();
  const win = fakeWindow();
  const layer = createWeatherLayer({ budget: 40, share: 1, seed: "storm", weather: { code: 95, rain_mm: 2, snow_cm: 0 }, win, doc: fakeDocument("weather halloween"), measure: () => [], request, release });
  const calls = [];
  const ctx = fakeContext(calls);
  // 60 Sekunden Gewitter in Schritten von 50 ms.
  let flashingFrames = 0;
  const starts = [];
  let was = false;
  for (let i = 0; i < 1200; i += 1) {
    layer.draw(ctx, 0.05, SIZE);
    const state = layer.state();
    if (state.flashing) flashingFrames += 1;
    if (state.flashing && !was) starts.push(state.clock);
    was = state.flashing;
  }
  const state = layer.state();
  expect(state).toMatchObject({ mode: "rain", thunder: true });
  expect(state.flashes).toBeGreaterThanOrEqual(2);
  expect(state.flashes).toBeLessThanOrEqual(8);
  expect(request).toHaveBeenCalledWith("lightning");
  expect(release.mock.calls.length).toBeGreaterThanOrEqual(state.flashes - 1);
  starts.forEach((at, index) => {
    if (index) expect(at - starts[index - 1]).toBeGreaterThanOrEqual(FLASH_GAP[0]);
  });
  expect(flashingFrames).toBeLessThan(state.flashes * 12);
  expect(calls.includes("fillRect")).toBe(true);
  expect(layer.idle()).toBe(false);
  layer.dispose();
  // Schnee-Saison: kein Gewitter, kein Regen - dort schneit es.
  const winter = createWeatherLayer({ budget: 40, share: 1, seed: "storm", weather: { code: 95, rain_mm: 2 }, win: fakeWindow(), doc: fakeDocument("weather snow advent"), measure: () => [], request, release });
  for (let i = 0; i < 800; i += 1) winter.draw(ctx, 0.05, SIZE);
  expect(winter.state()).toMatchObject({ mode: "none", thunder: false, flashes: 0 });
  expect(winter.idle()).toBe(true);
  winter.dispose();
  // Ohne Budget (versteckter Tab, Abklingzeit) kein Blitz - in drei Sekunden noch einmal fragen.
  const denied = createWeatherLayer({ budget: 40, share: 1, seed: "storm", weather: { code: 95, rain_mm: 0 }, win: fakeWindow(), doc: fakeDocument("weather"), measure: () => [], request: () => null, release });
  for (let i = 0; i < 800; i += 1) denied.draw(ctx, 0.05, SIZE);
  expect(denied.state()).toMatchObject({ mode: "none", thunder: true, flashes: 0 });
  denied.dispose();
});

test("Wetter-Ebene ruht ohne Niederschlag, wacht für Regen, Schnee und den nächsten Blitz; die Uhr läuft im Schlaf weiter", () => {
  const win = fakeWindow();
  const layer = createWeatherLayer({ budget: 40, share: 1, seed: "idle", weather: { code: 3, rain_mm: 0, snow_cm: 0 }, win, doc: fakeDocument("weather"), measure: () => [], request: () => ({ id: 1 }), release: () => {} });
  const ctx = fakeContext([]);
  layer.draw(ctx, 0.016, SIZE);
  expect(layer.state().mode).toBe("none");
  expect(layer.idle()).toBe(true);
  win.emit("tls:season-weather", { code: 61, rain_mm: 0.8, snow_cm: 0 });
  expect(layer.idle()).toBe(false);
  layer.draw(ctx, 0.016, SIZE);
  expect(layer.state().rain.counts.total).toBeGreaterThan(0);
  // Schnee außerhalb der Schnee-Saison: leicht, und nur solange es schneit.
  win.emit("tls:season-weather", { code: 73, rain_mm: 0, snow_cm: 1 });
  layer.draw(ctx, 0.016, SIZE);
  expect(layer.state().mode).toBe("snow");
  expect(layer.state().snow.counts.total).toBeGreaterThan(0);
  expect(layer.state().snow.counts.total).toBeLessThanOrEqual(24);
  win.emit("tls:season-weather", { code: 3, rain_mm: 0, snow_cm: 0 });
  for (let i = 0; i < 1200; i += 1) layer.draw(ctx, 0.05, SIZE);
  expect(layer.state()).toMatchObject({ mode: "none", snow: null });
  expect(layer.idle()).toBe(true);
  // Trockenes Gewitter: die Ebene ruht, bis der nächste Blitz nah ist - im Schlaf läuft die Uhr weiter.
  win.emit("tls:season-weather", { code: 95, rain_mm: 0, snow_cm: 0 });
  const before = layer.state();
  if (before.nextFlashAt - before.clock > 3) expect(layer.idle()).toBe(true);
  layer.slept(Math.max(0, before.nextFlashAt - before.clock - 1));
  expect(layer.idle()).toBe(false);
  layer.dispose();
  expect(win.listeners.size).toBe(0);
});
