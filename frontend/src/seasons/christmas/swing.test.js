import { readFileSync } from "node:fs";
import path from "node:path";
import { hashString } from "../rng";
import { chainLayout } from "./lights";
import { SWING, swingAt, swingPlan, tiltAt } from "./swing";

// Die Kette schwingt nach (#1091): zweimal hin und her, gut eine Sekunde, am Ende genau wie vorher; beim Loslassen
// dasselbe in klein; ein Licht flackert. Die Keyframes in christmas.css folgen denselben Stützstellen, die App rechnet
// mit derselben Rechnung (Fingerabdruck auf beiden Seiten).

/** Fingerabdruck dieser Rechnung - derselbe steht in mobile/src/seasons/christmas/swing.test.ts. */
const SWING_PARITY = 3121181676;

test("zweimal hin und her, jedes Mal kleiner, am Ende in Ruhe; beim Loslassen in klein", () => {
  expect(SWING.ms).toBeLessThan(2000);
  expect(swingAt(0)).toBe(0);
  expect(swingAt(SWING.ms)).toBe(0);
  expect(swingAt(SWING.ms * 3)).toBe(0);
  const peaks = SWING.keys.slice(1, -1).map(([t]) => swingAt(t * SWING.ms));
  expect(peaks.map(Math.sign)).toEqual([1, -1, 1, -1]);
  peaks.slice(1).forEach((peak, index) => expect(Math.abs(peak)).toBeLessThan(Math.abs(peaks[index])));
  expect(swingAt(0.16 * SWING.ms, SWING.leave)).toBeCloseTo(0.34 * SWING.leave, 4);
  expect(tiltAt(0.16 * SWING.ms, 7)).toBe(7);
  expect(tiltAt(SWING.ms, 7)).toBe(0);
});

test("ein Plan je Anheben: jedes Lämpchen zieht mit seiner Tiefe mit, eines flackert; gleiche Saat gleicher Plan", () => {
  const layout = chainLayout({ width: 420, year: "2026", anchor: "card:3" });
  const plan = swingPlan(layout.bulbs, "chain:card:3:1");
  expect(plan).toEqual(swingPlan(layout.bulbs, "chain:card:3:1"));
  expect(layout.bulbs.map((bulb) => bulb.index)).toContain(plan.blink);
  // Jedes Anheben ein anderes Licht.
  expect(new Set(Array.from({ length: 8 }, (_, n) => swingPlan(layout.bulbs, `chain:card:3:${n}`).blink)).size).toBeGreaterThan(1);
  plan.bulbs.forEach((entry, index) => {
    const bulb = layout.bulbs[index];
    expect(entry.h).toBeCloseTo(bulb.y - bulb.radius - 1, 1);
    expect(Math.abs(entry.tilt)).toBeGreaterThanOrEqual(SWING.tilt * 0.6 - 0.05);
    expect(Math.abs(entry.tilt)).toBeLessThanOrEqual(SWING.tilt + 0.05);
  });
  expect(swingPlan([], "leer")).toEqual({ blink: null, bulbs: [] });
});

test("die Keyframes in christmas.css folgen denselben Stützstellen", () => {
  const css = readFileSync(path.resolve(__dirname, "christmas.css"), "utf8").replace(/\r\n/g, "\n");
  const sag = /@keyframes tls-chain-sag \{([\s\S]*?)\n\}/.exec(css)[1];
  const bob = /@keyframes tls-chain-bob \{([\s\S]*?)\n\}/.exec(css)[1];
  // Beim Loslassen dieselben Keyframes unter eigenem Namen.
  expect(/@keyframes tls-chain-sag-leave \{([\s\S]*?)\n\}/.exec(css)[1]).toBe(sag);
  expect(/@keyframes tls-chain-bob-leave \{([\s\S]*?)\n\}/.exec(css)[1]).toBe(bob);
  SWING.keys.slice(1, -1).forEach(([t, v]) => {
    const step = `${Math.round(t * 100)}%`;
    const sign = v < 0 ? "-" : "+";
    expect(sag).toContain(`${step} { transform: scaleY(calc(1 ${sign} ${Math.abs(v)} * var(--amp, 1))); }`);
    expect(bob).toContain(`${step} { transform: translateY(calc(var(--h, 0px) * ${v} * var(--amp, 1)))`);
    const ratio = Math.round((v / SWING.keys[1][1]) * 10000) / 10000;
    expect(bob).toMatch(new RegExp(`${step} .*rotate\\(calc\\(var\\(--tilt, 0deg\\)( \\* ${String(ratio).replace(".", "\\.")})? \\* var\\(--amp, 1\\)\\)\\)`));
  });
  expect(css).toContain(`animation: tls-lights-blink ${SWING.blinkMs}ms ease-in-out ${SWING.blinkAt}ms both`);
});

test("Parität mit der App: dieselben Zahlen, dieselben Pläne", () => {
  const sample = {
    swing: SWING,
    at: [0, 50, 176, 300, 418, 560, 660, 800, 880, 1000, 1100, 1500].map((ms) => [swingAt(ms), swingAt(ms, SWING.leave), tiltAt(ms, -5.3)]),
    plan: swingPlan(chainLayout({ width: 354, year: "2026", anchor: "header" }).bulbs, "dashboard-hero:1700000000000"),
    card: swingPlan(chainLayout({ width: 512, year: "2027", anchor: "card:0" }).bulbs, "chain:card:4:7"),
  };
  expect(hashString(JSON.stringify(sample))).toBe(SWING_PARITY);
});
