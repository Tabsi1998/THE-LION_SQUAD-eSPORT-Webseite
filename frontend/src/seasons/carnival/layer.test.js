import { SKY_WAKE_EVENT } from "../sky";
import { BURST_COUNT, MAX_SECONDS, REST_MS, confettiCap, createConfettiLayer, landingEdges, lying, requestBurst } from "./layer";

// Die Konfetti-Ebene (Fasching F1 #745): Stücke je Gerät, Regen einmal beim Start, Explosionen auf Zuruf (weckt den
// schlafenden Himmel), Seitenkoordinaten beim Scrollen, kurzes Liegenbleiben auf Kartenkanten, danach Ruhe.

function fakeCtx() {
  const calls = { translate: [], fillRect: 0, arc: 0, lineTo: 0, alpha: [] };
  const ctx = {
    save: () => {},
    restore: () => {},
    translate: (x, y) => calls.translate.push([x, y]),
    rotate: () => {},
    scale: () => {},
    beginPath: () => {},
    arc: () => {
      calls.arc += 1;
    },
    fill: () => {
      calls.alpha.push(ctx.globalAlpha);
    },
    moveTo: () => {},
    lineTo: () => {
      calls.lineTo += 1;
    },
    closePath: () => {},
    fillRect: () => {
      calls.fillRect += 1;
      calls.alpha.push(ctx.globalAlpha);
    },
    globalAlpha: 1,
    fillStyle: "",
  };
  return { ctx, calls };
}

function setup(options = {}) {
  const clock = { now: 1000 };
  const win = { scrollY: 0, innerWidth: 1280, innerHeight: 800 };
  const layer = createConfettiLayer({ budget: 120, seed: 7, edges: () => [], clock: () => clock.now, win, ...options });
  const view = { width: 1280, height: 800 };
  const frame = (ms) => {
    clock.now += ms;
    const { ctx, calls } = fakeCtx();
    layer.draw(ctx, ms / 1000, view);
    return calls;
  };
  return { layer, clock, win, frame };
}

test("Stücke je Gerät: ein Viertel mehr als das Budget, höchstens 150 (normal) bzw. 300 (voll)", () => {
  expect(confettiCap(40)).toBe(50);
  expect(confettiCap(120)).toBe(150);
  expect(confettiCap(240)).toBe(150);
  expect(confettiCap(240, "full")).toBe(300);
  expect(confettiCap(0)).toBe(0);
  expect(confettiCap("x")).toBe(0);
});

test("Regen einmal beim Start: alle Stücke fliegen, nach spätestens vierzehn Sekunden ist Ruhe", () => {
  const { layer, frame } = setup({ rain: true });
  expect(layer.kind).toBe("confetti");
  expect(layer.snapshot()).toEqual({ flying: 150, resting: 0, cap: 150 });
  expect(layer.idle()).toBe(false);
  const drawn = frame(1200);
  expect(drawn.fillRect + drawn.arc).toBeGreaterThan(20);
  for (let i = 0; i < (MAX_SECONDS + 1) * 10; i += 1) frame(100);
  expect(layer.idle()).toBe(true);
  layer.dispose();
});

test("ohne Regen ruht die Ebene; eine Explosion weckt den Himmel und wirft eine Handvoll", () => {
  const { layer, frame } = setup();
  expect(layer.idle()).toBe(true);
  const woke = vi.fn();
  window.addEventListener(SKY_WAKE_EVENT, woke);
  requestBurst({ x: 300, y: 200 });
  window.removeEventListener(SKY_WAKE_EVENT, woke);
  expect(woke).toHaveBeenCalledTimes(1);
  expect(layer.snapshot().flying).toBe(BURST_COUNT);
  const drawn = frame(150);
  expect(drawn.translate.length).toBeGreaterThan(10);
  // Die Explosion fliegt erst nach oben und zur Seite, dann fällt sie.
  expect(Math.min(...drawn.translate.map(([, y]) => y))).toBeLessThan(200);
  layer.dispose();
  requestBurst({ x: 300, y: 200 });
  expect(layer.snapshot().flying).toBe(0);
});

test("nie mehr Stücke als erlaubt - auch nicht mit Regen und Explosionen zusammen", () => {
  const { layer } = setup({ rain: true, budget: 40 });
  expect(layer.snapshot().flying).toBe(50);
  requestBurst({ x: 10, y: 10 });
  expect(layer.snapshot().flying).toBe(50);
  layer.dispose();
});

test("Seitenkoordinaten: beim Scrollen ziehen die Stücke mit der Seite mit", () => {
  const first = setup();
  const second = setup();
  requestBurst({ x: 400, y: 300 });
  second.win.scrollY = 120;
  const a = first.frame(300).translate;
  const b = second.frame(300).translate;
  expect(a.length).toBe(b.length);
  a.forEach(([x, y], index) => {
    expect(b[index][0]).toBeCloseTo(x, 5);
    expect(b[index][1]).toBeCloseTo(y - 120, 5);
  });
  first.layer.dispose();
  second.layer.dispose();
});

test("Liegenbleiben: ein Teil landet auf einer Kartenkante, liegt ein paar Sekunden und verblasst", () => {
  const { layer, frame } = setup({ rain: true, edges: () => [{ left: 0, right: 1280, top: 420 }] });
  let resting = 0;
  for (let i = 0; i < 60 && !resting; i += 1) {
    frame(100);
    resting = layer.snapshot().resting;
  }
  expect(resting).toBeGreaterThan(0);
  // Nach der längsten Liegezeit plus Ausblenden ist nichts mehr da.
  for (let i = 0; i < (REST_MS[1] + 2000) / 100 + MAX_SECONDS * 10; i += 1) frame(100);
  expect(layer.snapshot().resting).toBe(0);
  expect(layer.idle()).toBe(true);
  layer.dispose();
});

test("liegend: die lange Seite waagrecht, leicht schief, so hoch über der Kante wie die halbe Dicke", () => {
  const rng = () => 0.75;
  const strip = { shape: "strip", w: 3, h: 14 };
  const flat = lying(strip, rng);
  expect(flat.piece.w).toBe(14);
  expect(flat.piece.h).toBe(3);
  expect(Math.abs(flat.angle)).toBeLessThan(0.2);
  expect(flat.lift).toBeGreaterThan(0);
  expect(flat.lift).toBeLessThan(2);
});

test("Kanten zum Liegenbleiben: nur Karten im Fenster, breit genug, in Seitenkoordinaten", () => {
  const card = (top, width) => ({ getBoundingClientRect: () => ({ top, bottom: top + 100, left: 20, right: 20 + width, width }) });
  const doc = { querySelectorAll: () => [card(100, 300), card(900, 300), card(200, 40)] };
  expect(landingEdges(doc, { scrollY: 50, innerHeight: 800 })).toEqual([{ left: 26, right: 314, top: 150 }]);
  expect(landingEdges(null, null)).toEqual([]);
});
