import { MOTION, PRESS_SCALE, STAGGER_MS, staggerMs } from "./motion";

// Bewegungs-Regeln (#1085): die App nimmt dieselben Zahlen wie das Web (ein Test im Web vergleicht theme.ts mit index.css).
test("die Werte stimmen mit dem Web ueberein und der Versatz ist begrenzt", () => {
  expect(MOTION).toEqual({ fast: 150, mid: 240, slow: 420, ease: [0.2, 0.7, 0.2, 1] });
  expect(PRESS_SCALE).toBeCloseTo(0.98);
  expect(STAGGER_MS).toBe(70);
  expect(staggerMs(0)).toBe(0);
  expect(staggerMs(3)).toBe(210);
  expect(staggerMs(50)).toBe(560);
  expect(staggerMs(-4)).toBe(0);
});
