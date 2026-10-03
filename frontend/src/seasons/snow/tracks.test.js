import { TRACKS_KEY, TRACK_FILL_MS, TRACK_REST_MS, TRACK_STEP_MS, dentsAt, markTracks, trackSteps, tracksDuration, tracksToday } from "./tracks";
import { capPath } from "./caps";

// Die Spur im Schnee (W5 #731): Schritte im gleichen Abstand, abwechselnd etwas tiefer, von links oder rechts; die
// Dellen erscheinen mit ihrem Schritt und rieseln am Ende zu; einmal am Tag je Gerät. Ohne Spur bleibt die Haube
// genau so, wie sie war.

test("Schritte: 24 px Abstand, abwechselnd tiefer, von links oder von rechts, höchstens 16", () => {
  const steps = trackSteps({ width: 300, thickness: 9, fromLeft: true });
  // Beginnt bei einem Fünftel der Breite, wo der Schnee voll ist (die Haube läuft an den Enden dünn aus).
  expect(steps.length).toBe(10);
  expect(steps[0]).toMatchObject({ x: 60, at: 0 });
  expect(steps[1].x - steps[0].x).toBe(24);
  expect(steps[0].depth).toBeLessThan(steps[1].depth);
  expect(steps[1].at).toBe(TRACK_STEP_MS);
  const back = trackSteps({ width: 300, thickness: 9, fromLeft: false });
  expect(back[0].x).toBe(300 - 60);
  expect(trackSteps({ width: 2000, thickness: 9 }).length).toBe(16);
  expect(trackSteps({ width: 20, thickness: 9 }).length).toBe(0);
});

test("Dellen erscheinen mit ihrem Schritt, frische stauben, nach der Ruhe rieseln sie zu - dann ist nichts mehr da", () => {
  const steps = trackSteps({ width: 200, thickness: 6.5 });
  const last = (steps.length - 1) * TRACK_STEP_MS;
  expect(dentsAt(steps, 0)).toHaveLength(1);
  expect(dentsAt(steps, 0)[0].fresh).toBe(true);
  expect(dentsAt(steps, TRACK_STEP_MS * 2 + 10)).toHaveLength(3);
  expect(dentsAt(steps, last + 5000).every((dent) => !dent.fresh && dent.depth === steps.find((step) => step.x === dent.x).depth)).toBe(true);
  const half = dentsAt(steps, last + TRACK_REST_MS + TRACK_FILL_MS / 2);
  expect(half[0].depth).toBeCloseTo(steps[0].depth / 2, 1);
  expect(dentsAt(steps, tracksDuration(steps))).toEqual([]);
});

test("einmal am Tag je Gerät", () => {
  const store = {};
  const storage = { getItem: (key) => store[key] ?? null, setItem: (key, value) => { store[key] = value; } };
  const day = new Date(2026, 11, 12, 18, 0);
  expect(tracksToday(storage, day)).toBe(false);
  markTracks(storage, day);
  expect(store[TRACKS_KEY]).toBe("2026-12-12");
  expect(tracksToday(storage, day)).toBe(true);
  expect(tracksToday(storage, new Date(2026, 11, 13, 9, 0))).toBe(false);
  expect(tracksToday(null, day)).toBe(false);
});

test("Haubenkontur: ohne Dellen unverändert, mit Dellen tiefer an der Stelle des Schritts", () => {
  const plain = capPath({ width: 240, thickness: 9, seed: "fuss", level: 3 });
  expect(capPath({ width: 240, thickness: 9, seed: "fuss", level: 3, dents: [] }).d).toBe(plain.d);
  const dented = capPath({ width: 240, thickness: 9, seed: "fuss", level: 3, dents: [{ x: 100, depth: 5, width: 7 }] });
  expect(dented.d).not.toBe(plain.d);
  // Der tiefste Punkt der Delle liegt bei x = 100 und tiefer (größeres y) als die Oberkante drumherum.
  const at = dented.d.match(/ 100\.0 (\d+\.\d)/);
  expect(at).toBeTruthy();
  expect(Number(at[1])).toBeGreaterThan(plain.base - 9);
  expect(dented.height).toBe(plain.height);
});
