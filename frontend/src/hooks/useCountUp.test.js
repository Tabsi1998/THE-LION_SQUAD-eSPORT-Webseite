import { canAnimateNumbers, easeOutExpo } from "./useCountUp";

// Zahlen hochzählen (#425): schnell anlaufen, dann langsam; ohne matchMedia oder mit „Bewegung
// reduzieren“ wird nicht animiert.

test("Ease-out: die erste Hälfte der Zeit macht den Großteil des Wegs", () => {
  expect(easeOutExpo(0)).toBe(0);
  expect(easeOutExpo(1)).toBe(1);
  expect(easeOutExpo(0.25)).toBeGreaterThan(0.8);
  expect(easeOutExpo(0.5)).toBeGreaterThan(easeOutExpo(0.25));
  expect(easeOutExpo(0.5)).toBeLessThan(1);
});

test("animiert nur mit matchMedia, requestAnimationFrame und ohne „Bewegung reduzieren“", () => {
  expect(canAnimateNumbers(null)).toBe(false);
  expect(canAnimateNumbers({})).toBe(false);
  const win = (reduce) => ({ matchMedia: () => ({ matches: reduce }), requestAnimationFrame: () => 1 });
  expect(canAnimateNumbers(win(true))).toBe(false);
  expect(canAnimateNumbers(win(false))).toBe(true);
});
