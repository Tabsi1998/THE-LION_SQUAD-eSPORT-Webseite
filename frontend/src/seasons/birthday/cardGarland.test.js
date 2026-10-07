import { readFileSync } from "node:fs";
import path from "node:path";
import { hashString } from "../rng";
import { PENNANT_COLORS } from "./garland";
import { EDGE_GARLAND, PENNANT_FLUTTER, edgePennants, edgeString, pennantAngle, pennantDelay } from "./cardGarland";

// Eine Wimpelkette an einer Karte (#1094): dieselbe wie an der Begrüßungskarte der App, von Rand zu Rand im unteren
// Innenabstand; beim Anheben flattert sie einmal durch - in einer Sekunde, von links nach rechts. Die Keyframes in
// birthday.css folgen denselben Stützstellen, die App rechnet mit derselben Rechnung (Fingerabdruck auf beiden Seiten).

/** Fingerabdruck dieser Rechnung - derselbe steht in mobile/src/seasons/birthday/garland.test.ts. */
const GARLAND_PARITY = 2695102931;

test("Wimpel über die ganze Breite, im Band, Vereinsfarben im Wechsel; je Jahr und Karte fest", () => {
  const pennants = edgePennants(420, 2027, "card:2");
  expect(pennants).toEqual(edgePennants(420, 2027, "card:2"));
  expect(pennants).not.toEqual(edgePennants(420, 2027, "card:3"));
  expect(pennants.length).toBe(Math.round((420 - 2 * EDGE_GARLAND.inset) / EDGE_GARLAND.step));
  pennants.forEach((pennant, index) => {
    expect(pennant.x).toBeGreaterThan(EDGE_GARLAND.inset);
    expect(pennant.x).toBeLessThan(420 - EDGE_GARLAND.inset);
    expect(pennant.y + pennant.size * 0.9).toBeLessThan(EDGE_GARLAND.band);
    expect(PENNANT_COLORS).toContain(pennant.color);
    if (index) expect(pennant.color).not.toBe(pennants[index - 1].color);
  });
  expect(edgeString(pennants, 420)).toMatch(/^M 0 1 L .* L 420 1$/);
  expect(edgePennants(100, 2027, "card:1")).toEqual([]);
  expect(edgeString([], 100)).toBe("");
});

test("Flattern: eine Welle von links nach rechts, jeder Wimpel schwingt und kommt zur Ruhe - alles in einer Sekunde", () => {
  const count = 20;
  expect(pennantDelay(0, count)).toBe(0);
  expect(pennantDelay(count - 1, count) + PENNANT_FLUTTER.each).toBe(PENNANT_FLUTTER.ms);
  expect(pennantDelay(0, 1)).toBe(0);
  expect(pennantAngle(0, 0, count)).toBe(0);
  expect(pennantAngle(0.2 * PENNANT_FLUTTER.each, 0, count)).toBe(PENNANT_FLUTTER.swing);
  // Der letzte Wimpel wartet, bis die Welle bei ihm ist.
  expect(pennantAngle(0.2 * PENNANT_FLUTTER.each, count - 1, count)).toBe(0);
  for (let index = 0; index < count; index += 1) expect(pennantAngle(PENNANT_FLUTTER.ms, index, count)).toBe(0);
  expect(PENNANT_FLUTTER.ms).toBeLessThan(2000);
});

test("die Keyframes in birthday.css folgen denselben Stützstellen", () => {
  const css = readFileSync(path.resolve(__dirname, "birthday.css"), "utf8").replace(/\r\n/g, "\n");
  const flutter = /@keyframes tls-cgarland-flutter \{([\s\S]*?)\n\}/.exec(css)[1];
  PENNANT_FLUTTER.keys.slice(1, -1).forEach(([t, v]) => {
    const deg = Math.round(v * PENNANT_FLUTTER.swing * 100) / 100;
    expect(flutter).toContain(`${Math.round(t * 100)}% { transform: rotate(${deg}deg); }`);
  });
  expect(css).toContain(`animation: tls-cgarland-flutter ${PENNANT_FLUTTER.each}ms`);
});

test("Parität mit der App: dieselben Zahlen, dieselben Wimpel - auch an der Begrüßungskarte", () => {
  const sample = {
    garland: EDGE_GARLAND,
    flutter: PENNANT_FLUTTER,
    edge: edgePennants(354, 2027),
    card: edgePennants(512, 2026, "card:0"),
    delays: [0, 3, 9, 17].map((index) => pennantDelay(index, 18)),
    angles: [0, 90, 136, 250, 306, 476, 600, 900, 1000].map((ms) => pennantAngle(ms, 4, 18)),
  };
  expect(hashString(JSON.stringify(sample))).toBe(GARLAND_PARITY);
});
