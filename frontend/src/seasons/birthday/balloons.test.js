import { mulberry32 } from "../rng";
import { BALLOON_COLORS, balloonAt, balloonWave, createBalloonLayer, nextCelebration, requestBalloons, waveSize } from "./balloons";

// Luftballons am Vereinsgeburtstag (#856): kleine Wellen an den Rändern, Start unter dem Fenster in Seitenkoordinaten,
// sie steigen und pendeln; die Ebene schläft zwischen den Wellen.

test("eine Welle: wenige Ballons, abwechselnd links und rechts im äußeren Streifen, Start unter dem Fenster", () => {
  expect(waveSize(0)).toBe(0);
  expect(waveSize(120)).toBe(3);
  expect(waveSize(240, "full")).toBe(4);
  const wave = balloonWave(mulberry32(7), { width: 1440, height: 900 }, 4, 1200);
  expect(wave).toHaveLength(4);
  const sides = wave.map((balloon) => (balloon.x < 720 ? "left" : "right"));
  expect(sides[0]).not.toBe(sides[1]);
  wave.forEach((balloon) => {
    expect(balloon.x < 1440 * 0.12 || balloon.x > 1440 * 0.88).toBe(true);
    expect(balloon.startY).toBeGreaterThan(1200 + 900);
    expect(BALLOON_COLORS[balloon.color]).toBeTruthy();
    expect(balloon.speed).toBeGreaterThanOrEqual(36);
  });
  const phone = balloonWave(mulberry32(7), { width: 390, height: 800 }, 2);
  phone.forEach((balloon) => expect(balloon.size).toBeLessThan(25));
});

test("ein Ballon steigt und pendelt, ohne zur Seite wegzulaufen", () => {
  const balloon = { x: 100, startY: 1000, size: 24, speed: 50, sway: 10, swayHz: 0.2, phase: 0, color: 0, delay: 0 };
  expect(balloonAt(balloon, 0).y).toBe(1000);
  expect(balloonAt(balloon, 4).y).toBe(800);
  for (let t = 0; t < 20; t += 0.7) expect(Math.abs(balloonAt(balloon, t).x - 100)).toBeLessThanOrEqual(10);
});

function fakeContext() {
  const calls = [];
  const gradient = { addColorStop: () => {} };
  return new Proxy({ calls }, {
    get: (target, key) => (key in target ? target[key] : key === "createRadialGradient" ? () => gradient : (...args) => calls.push([key, ...args])),
    set: () => true,
  });
}

test("die Ebene nimmt Wellen auf, zeichnet nur, was im Fenster ist, und schläft danach", () => {
  let now = 0;
  const win = { innerWidth: 1280, innerHeight: 800, scrollY: 0 };
  const layer = createBalloonLayer({ budget: 120, seed: 3, clock: () => now, win });
  expect(layer.idle()).toBe(true);
  requestBalloons();
  expect(layer.snapshot().flying).toBe(3);
  expect(layer.idle()).toBe(false);
  const ctx = fakeContext();
  now = 8000;
  layer.draw(ctx, 16, { width: 1280, height: 800 });
  expect(ctx.calls.some(([name]) => name === "ellipse")).toBe(true);
  now = 120000;
  layer.draw(ctx, 16, { width: 1280, height: 800 });
  expect(layer.idle()).toBe(true);
  layer.dispose();
  requestBalloons();
  expect(layer.snapshot().flying).toBe(0);
});

test("der Takt: Ballons alle 70 bis 120 Sekunden (die erste nach 2,5), Konfetti alle drei bis fünf Minuten", () => {
  expect(nextCelebration("balloons", () => 0, true)).toBe(2500);
  expect(nextCelebration("balloons", () => 0)).toBe(70000);
  expect(nextCelebration("balloons", () => 1)).toBe(120000);
  expect(nextCelebration("confetti", () => 0)).toBe(180000);
  expect(nextCelebration("confetti", () => 1)).toBe(300000);
});
