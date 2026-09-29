import { IDLE_CHECK_MS, MAX_AREA_FACTOR, TIERS, areaFactor, budgetFor, createSkyLoop, particleBudget } from "./sky";

// Der Zeichen-Loop (#634, #673): Budget nach Gerät und Stärke; ein Loop für alle Ebenen; ruhen alle Ebenen, schläft
// er, zeichnet kein Bild, gibt den Speicher der Zeichenfläche frei und schaut alle zwei Sekunden nach - die Uhren der
// Ebenen laufen dabei weiter; versteckter Tab pausiert.

function fakeEnvironment() {
  const frames = [];
  const timers = [];
  const listeners = {};
  const win = {
    innerWidth: 1000,
    innerHeight: 600,
    devicePixelRatio: 1,
    requestAnimationFrame: (fn) => {
      frames.push(fn);
      return frames.length;
    },
    cancelAnimationFrame: () => {},
    setTimeout: (fn, ms) => {
      timers.push({ fn, ms });
      return timers.length;
    },
    clearTimeout: (id) => {
      if (timers[id - 1]) timers[id - 1].cleared = true;
    },
    addEventListener: (name, fn) => {
      listeners[name] = fn;
    },
    removeEventListener: (name) => {
      delete listeners[name];
    },
  };
  const doc = { hidden: false, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: (name) => { delete listeners[name]; } };
  const calls = [];
  const ctx = { clearRect: () => calls.push("clear"), setTransform: () => {} };
  const canvas = { getContext: () => ctx, style: {}, width: 0, height: 0 };
  const step = (now) => {
    const fn = frames.shift();
    if (fn) fn(now);
  };
  return { win, doc, canvas, frames, timers, listeners, calls, step };
}

test("Budget nach Gerät und Stärke", () => {
  expect(particleBudget({ navigator: { hardwareConcurrency: 2, deviceMemory: 8 }, innerWidth: 1440 })).toBe(TIERS.low);
  expect(particleBudget({ navigator: { hardwareConcurrency: 4, deviceMemory: 8 }, innerWidth: 1440 })).toBe(TIERS.mid);
  expect(particleBudget({ navigator: { hardwareConcurrency: 12, deviceMemory: 8 }, innerWidth: 1440 })).toBe(TIERS.high);
  expect(particleBudget({ navigator: { hardwareConcurrency: 12, deviceMemory: 8 }, innerWidth: 390 })).toBe(TIERS.low);
  expect(budgetFor("subtle", 240)).toBe(0);
  expect(budgetFor("normal", 240)).toBe(120);
  expect(budgetFor("full", 240)).toBe(240);
});

test("große Fenster brauchen mehr Teilchen für dieselbe Dichte - nie weniger als am Bezugsfenster, höchstens das Doppelte", () => {
  expect(areaFactor({ width: 1440, height: 900 })).toBe(1);
  expect(areaFactor({ width: 390, height: 844 })).toBe(1);
  expect(areaFactor({ width: 1920, height: 1080 })).toBeCloseTo(1.6, 5);
  expect(areaFactor({ width: 2560, height: 1300 })).toBe(MAX_AREA_FACTOR);
  expect(areaFactor({ width: 3840, height: 2160 })).toBe(MAX_AREA_FACTOR);
  expect(areaFactor(null)).toBe(1);
  expect(areaFactor({ width: 0, height: 900 })).toBe(1);
});

test("ein Loop für alle Ebenen: läuft nur mit Ebenen, zeichnet jede, hört mit der letzten auf; versteckter Tab pausiert", () => {
  const env = fakeEnvironment();
  const loop = createSkyLoop(env.canvas, { win: env.win, doc: env.doc });
  expect(loop.running).toBe(false);
  // Ohne Ebene hat die Zeichenfläche keinen Speicher, liegt aber schon über dem ganzen Fenster.
  expect([env.canvas.width, env.canvas.height, env.canvas.style.width, env.canvas.style.height]).toEqual([1, 1, "1000px", "600px"]);
  const drawn = [];
  const remove = loop.add({ draw: (_ctx, dt, size) => drawn.push([dt, size.width]) });
  expect(loop.running).toBe(true);
  expect([env.canvas.width, env.canvas.height]).toEqual([1000, 600]);
  env.step(1000);
  env.step(1016);
  expect(drawn).toEqual([[0, 1000], [0.016, 1000]]);
  // Fenstergröße: die Zeichenfläche folgt, mit höchstens doppelter Dichte.
  env.win.innerWidth = 800;
  env.win.devicePixelRatio = 3;
  env.listeners.resize();
  expect([env.canvas.width, env.canvas.height, env.canvas.style.width]).toEqual([1600, 1200, "800px"]);
  env.doc.hidden = true;
  env.listeners.visibilitychange();
  expect(loop.running).toBe(false);
  expect(loop.parked).toBe(true);
  expect(env.canvas.width).toBe(1);
  env.doc.hidden = false;
  env.listeners.visibilitychange();
  expect(loop.running).toBe(true);
  expect(env.canvas.width).toBe(1600);
  remove();
  expect(loop.running).toBe(false);
  expect(loop.parked).toBe(true);
  loop.destroy();
  expect(env.listeners.resize).toBeUndefined();
});

test("ruhen alle Ebenen, schläft der Loop: kein Bild, kein Speicher, alle zwei Sekunden nachschauen; die Uhren der Ebenen laufen weiter; eine wache Ebene hält ihn wach", () => {
  const env = fakeEnvironment();
  const loop = createSkyLoop(env.canvas, { win: env.win, doc: env.doc });
  let idle = true;
  const slept = [];
  const draws = [];
  loop.add({ draw: () => draws.push("weather"), idle: () => idle, slept: (seconds) => slept.push(seconds) });
  // Ein trockener Tag: von Anfang an Ruhe - kein einziges Bild, die Zeichenfläche bleibt ein Punkt.
  expect(loop.running).toBe(false);
  expect(loop.sleeping).toBe(true);
  expect(loop.parked).toBe(true);
  expect(env.frames).toHaveLength(0);
  expect([env.canvas.width, env.canvas.height]).toEqual([1, 1]);
  const timer = env.timers[env.timers.length - 1];
  expect(timer.ms).toBe(IDLE_CHECK_MS);
  // Nachschauen kostet kein Bild: immer noch Ruhe, wieder schlafen - die Uhr der Ebene bekommt die Zeit gutgeschrieben.
  timer.fn();
  expect(loop.running).toBe(false);
  expect(loop.sleeping).toBe(true);
  expect(env.frames).toHaveLength(0);
  expect(draws).toHaveLength(0);
  expect(env.calls).toHaveLength(0);
  expect(slept).toHaveLength(1);
  expect(slept[0]).toBeGreaterThanOrEqual(0);
  // Im Schlaf ändert sich die Fenstergröße: die Zeichenfläche bleibt ein Punkt, liegt aber über dem neuen Fenster.
  env.win.innerWidth = 1200;
  env.listeners.resize();
  expect([env.canvas.width, env.canvas.style.width]).toEqual([1, "1200px"]);
  // Es beginnt zu regnen: beim nächsten Nachschauen wacht der Loop auf und die Zeichenfläche bekommt ihre Größe.
  idle = false;
  env.timers[env.timers.length - 1].fn();
  expect(loop.running).toBe(true);
  expect(loop.sleeping).toBe(false);
  expect(loop.parked).toBe(false);
  expect([env.canvas.width, env.canvas.height]).toEqual([1200, 600]);
  env.step(5000);
  env.step(5016);
  expect(draws).toHaveLength(2);
  // Der Regen ist vorbei: nach dem letzten Bild schläft der Loop wieder und gibt den Speicher frei.
  idle = true;
  env.step(5032);
  expect(draws).toHaveLength(3);
  expect(loop.running).toBe(false);
  expect(loop.sleeping).toBe(true);
  expect(env.canvas.width).toBe(1);
  // Eine zweite Ebene ohne `idle` (Netz, Schwarm) weckt ihn sofort und hält ihn wach.
  loop.add({ draw: () => draws.push("web") });
  expect(loop.running).toBe(true);
  expect(loop.sleeping).toBe(false);
  env.step(6000);
  env.step(6016);
  expect(draws.slice(-2)).toEqual(["weather", "web"]);
  expect(loop.running).toBe(true);
  loop.destroy();
  expect(loop.running).toBe(false);
  expect(loop.sleeping).toBe(false);
});
