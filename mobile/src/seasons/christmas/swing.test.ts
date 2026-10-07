import { hashString } from "../rng";
import { chainLayout } from "./lights";
import { SWING, blinkFrames, swingAt, swingFrames, swingPlan, tiltAt } from "./swing";

// Die Kette schwingt nach (#1091) - dieselbe Rechnung wie im Web (frontend/src/seasons/christmas/swing.test.js,
// derselbe Fingerabdruck): zweimal hin und her, gut eine Sekunde, am Ende genau wie vorher; ein Licht flackert.

/** Fingerabdruck der Web-Rechnung (swing.js) für dieselben Eingaben. */
const SWING_PARITY = 3121181676;

test("zweimal hin und her, jedes Mal kleiner, am Ende in Ruhe", () => {
  expect(swingAt(0)).toBe(0);
  expect(swingAt(SWING.ms)).toBe(0);
  const peaks = SWING.keys.slice(1, -1).map(([t]) => swingAt(t * SWING.ms));
  expect(peaks.map(Math.sign)).toEqual([1, -1, 1, -1]);
  peaks.slice(1).forEach((peak, index) => expect(Math.abs(peak)).toBeLessThan(Math.abs(peaks[index])));
  expect(tiltAt(0.16 * SWING.ms, 7)).toBe(7);
});

test("Animationen aus denselben Stützstellen: Durchhang, Mitziehen, ein Flackern", () => {
  expect(swingFrames(10)).toEqual({ inputRange: [0, 0.16, 0.38, 0.6, 0.8, 1], outputRange: [0, 3.4, -2, 1.2, -0.5, 0] });
  const blink = blinkFrames();
  expect(blink.inputRange[0]).toBe(0);
  expect(blink.inputRange[blink.inputRange.length - 1]).toBe(1);
  blink.inputRange.slice(1).forEach((t, index) => expect(t).toBeGreaterThan(blink.inputRange[index]));
  expect(Math.min(...blink.outputRange)).toBeLessThan(0.5);
  expect(blink.outputRange[blink.outputRange.length - 1]).toBe(1);
});

test("Parität mit dem Web: dieselben Zahlen, dieselben Pläne", () => {
  const sample = {
    swing: SWING,
    at: [0, 50, 176, 300, 418, 560, 660, 800, 880, 1000, 1100, 1500].map((ms) => [swingAt(ms), swingAt(ms, SWING.leave), tiltAt(ms, -5.3)]),
    plan: swingPlan(chainLayout({ width: 354, year: "2026", anchor: "header" }).bulbs, "dashboard-hero:1700000000000"),
    card: swingPlan(chainLayout({ width: 512, year: "2027", anchor: "card:0" }).bulbs, "chain:card:4:7"),
  };
  expect(hashString(JSON.stringify(sample))).toBe(SWING_PARITY);
});
