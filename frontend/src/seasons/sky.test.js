import { IDLE_CHECK_MS, TIERS, budgetFor, createSkyLoop, particleBudget } from "./sky";

// Der Zeichen-Loop (#634, #673): Budget nach Gerät und Stärke; ein Loop für alle Ebenen; ruhen alle Ebenen, schläft
// er und schaut alle zwei Sekunden nach - die Uhren der Ebenen laufen dabei weiter; versteckter Tab pausiert.

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

test("ein Loop für alle Ebenen: läuft nur mit Ebenen, zeichnet jede, hört mit der letzten auf; versteckter Tab pausiert", () => {
  const env = fakeEnvironment();
  const loop = createSkyLoop(env.canvas, { win: env.win, doc: env.doc });
  expect(loop.running).toBe(false);
  const drawn = [];
  const remove = loop.add({ draw: (_ctx, dt, size) => drawn.push([dt, size.width]) });
  expect(loop.running).toBe(true);
  env.step(1000);
  env.step(1016);
  expect(drawn).toEqual([[0, 1000], [0.016, 1000]]);
  env.doc.hidden = true;
  env.listeners.visibilitychange();
  expect(loop.running).toBe(false);
  env.doc.hidden = false;
  env.listeners.visibilitychange();
  expect(loop.running).toBe(true);
  remove();
  expect(loop.running).toBe(false);
  loop.destroy();
  expect(env.listeners.resize).toBeUndefined();
});

test("ruhen alle Ebenen, schläft der Loop und schaut alle zwei Sekunden nach; die Uhren der Ebenen laufen weiter; eine wache Ebene hält ihn wach", () => {
  const env = fakeEnvironment();
  const loop = createSkyLoop(env.canvas, { win: env.win, doc: env.doc });
  let idle = true;
  const slept = [];
  const draws = [];
  loop.add({ draw: () => draws.push("weather"), idle: () => idle, slept: (seconds) => slept.push(seconds) });
  env.step(1000);
  expect(draws).toHaveLength(1);
  expect(loop.running).toBe(false);
  expect(loop.sleeping).toBe(true);
  expect(env.frames).toHaveLength(0);
  const timer = env.timers[env.timers.length - 1];
  expect(timer.ms).toBe(IDLE_CHECK_MS);
  // Nachschauen: ein Bild, immer noch Ruhe, wieder schlafen.
  timer.fn();
  expect(loop.running).toBe(true);
  expect(slept).toHaveLength(1);
  expect(slept[0]).toBeGreaterThanOrEqual(0);
  env.step(3000);
  expect(draws).toHaveLength(2);
  expect(loop.sleeping).toBe(true);
  // Es beginnt zu regnen: beim nächsten Nachschauen bleibt der Loop wach.
  idle = false;
  env.timers[env.timers.length - 1].fn();
  env.step(5000);
  env.step(5016);
  expect(draws).toHaveLength(4);
  expect(loop.running).toBe(true);
  expect(loop.sleeping).toBe(false);
  // Eine zweite Ebene ohne `idle` (Netz, Schwarm) hält den Loop immer wach.
  idle = true;
  loop.add({ draw: () => draws.push("web") });
  env.step(5032);
  expect(loop.running).toBe(true);
  loop.destroy();
  expect(loop.running).toBe(false);
  expect(loop.sleeping).toBe(false);
});
