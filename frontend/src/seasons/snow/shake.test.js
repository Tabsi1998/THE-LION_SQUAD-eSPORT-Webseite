import { SHAKE, shakeDone, shakeDuration, shakeFlakes, shakeLevel } from "./shake";

// Schnee abschütteln (#1088): in einer halben Sekunde auf ein Fünftel, in 90 Sekunden zurück; Flocken über die freien
// Stücke verteilt, jede fällt 60 bis 120 px und ist spätestens nach 1,9 s weg.

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
