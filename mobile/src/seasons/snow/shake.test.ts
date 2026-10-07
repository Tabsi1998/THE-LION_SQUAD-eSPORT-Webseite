import { hashString } from "../rng";
import { SHAKE, shakeDone, shakeDuration, shakeFlakes, shakeLevel } from "./shake";

// Schnee abschütteln in der App (#1088): dieselbe Rechnung wie im Web - dieselben Fälle wie in
// frontend/src/seasons/snow/shake.test.js und derselbe Fingerabdruck. In einer halben Sekunde auf ein Fünftel, in 90
// Sekunden zurück; Flocken über die Haube verteilt, jede fällt 60 bis 120 px und ist spätestens nach 1,9 s weg.

/** Fingerabdruck der Web-Rechnung (frontend/src/seasons/snow/shake.js, Stand #1088) für dieselben Eingaben. */
const SHAKE_PARITY = 16254252;

test("die Haube fällt in einer halben Sekunde auf ein Fünftel und wächst in 90 Sekunden nach", () => {
  expect(shakeLevel(0)).toBe(1);
  expect(shakeLevel(SHAKE.detachMs)).toBe(SHAKE.keep);
  expect(shakeLevel(SHAKE.detachMs / 2)).toBeLessThan(0.5);
  expect(shakeLevel(SHAKE.detachMs + SHAKE.regrowMs / 2)).toBeCloseTo(0.6, 2);
  expect(shakeLevel(SHAKE.detachMs + SHAKE.regrowMs)).toBe(1);
  expect(shakeLevel(SHAKE.detachMs + SHAKE.regrowMs * 2)).toBe(1);
  expect(shakeDone(SHAKE.detachMs + SHAKE.regrowMs - 1)).toBe(false);
  expect(shakeDone(SHAKE.detachMs + SHAKE.regrowMs)).toBe(true);
});

test("Flocken nur über den freien Stücken, gleiche Saat gleiche Flocken, alle fallen und verschwinden", () => {
  const runs = [{ from: 0, to: 90 }, { from: 140, to: 230 }];
  const flakes = shakeFlakes({ runs, thickness: 6.5, seed: "cap:card:3:1" });
  expect(flakes).toEqual(shakeFlakes({ runs, thickness: 6.5, seed: "cap:card:3:1" }));
  expect(flakes).not.toEqual(shakeFlakes({ runs, thickness: 6.5, seed: "cap:card:3:2" }));
  expect(flakes.length).toBe(20);
  flakes.forEach((flake) => {
    const inRun = runs.some((run) => flake.x >= run.from && flake.x <= run.to);
    expect(inRun).toBe(true);
    expect(flake.fall).toBeGreaterThanOrEqual(60);
    expect(flake.fall).toBeLessThanOrEqual(120);
    expect(flake.delay).toBeLessThanOrEqual(SHAKE.detachMs);
    expect(flake.y).toBeLessThanOrEqual(0);
  });
  // Der Wind weht für die meisten in eine Richtung.
  const right = flakes.filter((flake) => flake.drift > 0).length;
  expect(Math.max(right, flakes.length - right)).toBeGreaterThanOrEqual(flakes.length * 0.6);
  expect(shakeDuration(flakes)).toBeLessThanOrEqual(SHAKE.detachMs + SHAKE.fallMs[1]);
});

test("lange Kanten: höchstens 36 Flocken, kurze Reste keine", () => {
  expect(shakeFlakes({ runs: [{ from: 0, to: 1200 }] }).length).toBe(SHAKE.max);
  expect(shakeFlakes({ runs: [{ from: 0, to: 5 }] })).toEqual([]);
  expect(shakeDuration([])).toBe(0);
});

test("Parität mit dem Web: dieselben Zahlen, dieselben Flocken", () => {
  expect(SHAKE).toEqual({ detachMs: 500, fall: [60, 120], drift: [6, 26], fallMs: [900, 1400], keep: 0.2, regrowMs: 90000, spacing: 9, max: 36 });
  const sample: Record<string, unknown> = {
    shake: SHAKE,
    levels: [0, 50, 125, 250, 375, 500, 501, 9500, 45500, 90499, 90500, 120000].map((t) => shakeLevel(t)),
    done: [0, 90499, 90500, 200000].map((t) => shakeDone(t)),
    flakes: shakeFlakes({ runs: [{ from: 0, to: 90 }, { from: 140, to: 230 }], thickness: 6.5, seed: "cap:card:3:1" }),
    hero: shakeFlakes({ runs: [{ from: 0, to: 334 }], thickness: 4, seed: "dashboard-hero:1700000000000" }),
    short: shakeFlakes({ runs: [{ from: 0, to: 5 }, { from: 10, to: 30 }] }),
  };
  sample.duration = shakeDuration(sample.flakes as ReturnType<typeof shakeFlakes>);
  expect(sample.duration).toBe(1678);
  expect(hashString(JSON.stringify(sample))).toBe(SHAKE_PARITY);
});
