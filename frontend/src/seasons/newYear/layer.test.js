import { LATE_MS, LOOKAHEAD_MS, createFireworksLayer, showCap } from "./layer";
import { launchDuration, SMOKE_SECONDS } from "./fireworks";

// Feuerwerks-Ebene (S9, N1, N5): startet zur Serverzeit, holt nach einem versteckten Tab nichts nach, hält das
// Teilchenbudget, räumt fertige Raketen und Rauch weg und schläft, wenn nichts ansteht.

const SIZE = { width: 1280, height: 800 };

function rocket(id, at, overrides = {}) {
  return { id, at, type: "peony", x: 0.5, distance: 0.3, colors: ["blue", "gold"], burstY: 0.25, rise: 1.2, drift: 0, ...overrides };
}

function mockCtx() {
  const calls = { drawImage: 0, fill: 0 };
  return {
    calls,
    save() {},
    restore() {},
    beginPath() {},
    arc() {},
    fill() {
      calls.fill += 1;
    },
    drawImage() {
      calls.drawImage += 1;
    },
    createRadialGradient: () => ({ addColorStop() {} }),
    set globalAlpha(value) {
      this._alpha = value;
    },
    get globalAlpha() {
      return this._alpha;
    },
  };
}

test("Budget je Gerät wie in #640: 200, 600, 1200", () => {
  expect([showCap(40), showCap(120), showCap(240)]).toEqual([200, 600, 1200]);
});

test("startet zur Serverzeit, meldet Aufstieg und Knall, zerplatzt nach dem Aufstieg und räumt danach auf", () => {
  let now = 10_000;
  const launched = [];
  const burst = [];
  const layer = createFireworksLayer({ plan: () => [rocket("a", 11_000)], clock: () => now, budget: 120, doc: null, onLaunch: (l) => launched.push(l.id), onBurst: (l) => burst.push(l.id) });
  layer.update(now, SIZE);
  expect(layer.snapshot().live).toBe(0);
  now = 11_050;
  layer.update(now, SIZE);
  expect(launched).toEqual(["a"]);
  expect(layer.snapshot().live).toBe(1);
  now = 11_000 + 1200 + 20;
  layer.update(now, SIZE);
  expect(burst).toEqual(["a"]);
  expect(layer.snapshot().particles).toBeGreaterThan(12);
  expect(layer.snapshot().smoke).toBe(1);
  now = 11_000 + launchDuration(rocket("a", 0)) * 1000 + 50;
  layer.update(now, SIZE);
  expect(layer.snapshot().live).toBe(0);
  now = 11_000 + 1200 + SMOKE_SECONDS * 1000 + 50;
  layer.update(now, SIZE);
  expect(layer.snapshot().smoke).toBe(0);
});

test("nach einem versteckten Tab kein Nachholen: zu spät gekommene Raketen bleiben aus", () => {
  const launched = [];
  const layer = createFireworksLayer({ plan: () => [rocket("old", 1_000), rocket("fresh", 9_500)], clock: () => 10_000, doc: null, onLaunch: (l) => launched.push(l.id) });
  layer.update(1_000 + LATE_MS + 8_000, SIZE);
  layer.update(10_000, SIZE);
  expect(launched).toEqual(["fresh"]);
});

test("Budget: bei vielen Raketen gleichzeitig weniger Sterne je Explosion - nie mehr Teilchen als erlaubt (plus Mindestmaß)", () => {
  const plan = Array.from({ length: 30 }, (_, i) => rocket(`r${i}`, 1_000));
  const layer = createFireworksLayer({ plan: () => plan, clock: () => 1_000, budget: 40, doc: null });
  layer.update(1_000, SIZE);
  layer.update(1_000 + 1_250, SIZE);
  const { particles, cap } = layer.snapshot();
  expect(cap).toBe(200);
  // Jede Explosion hat mindestens zwölf Sterne - darüber hinaus bleibt das Budget gewahrt.
  expect(particles).toBeLessThanOrEqual(cap + 30 * 12);
});

test("schläft, wenn nichts in der Luft ist und in den nächsten Sekunden nichts startet; zeichnet ohne Fehler", () => {
  let now = 0;
  const layer = createFireworksLayer({ plan: () => [rocket("later", 60_000)], clock: () => now, doc: null });
  expect(layer.idle()).toBe(true);
  now = 60_000 - LOOKAHEAD_MS + 100;
  expect(layer.idle()).toBe(false);
  now = 60_050;
  const ctx = mockCtx();
  layer.draw(ctx, 16, SIZE);
  expect(layer.idle()).toBe(false);
  now = 61_400;
  layer.draw(ctx, 16, SIZE);
  expect(ctx.calls.fill).toBeGreaterThan(0);
  layer.dispose();
  expect(layer.snapshot().live).toBe(0);
});
