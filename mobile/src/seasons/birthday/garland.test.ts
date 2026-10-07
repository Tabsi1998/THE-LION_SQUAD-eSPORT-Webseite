import { hashString } from "../rng";
import { EDGE_GARLAND, PENNANT_FLUTTER, edgePennants, edgeString, pennantAngle, pennantDelay, pennantFrames } from "./garland";

// Wimpelketten an Kanten (#1094) - dieselbe Rechnung wie im Web (frontend/src/seasons/birthday/cardGarland.test.js,
// derselbe Fingerabdruck): von Rand zu Rand, beim Antippen eine Welle von links nach rechts in einer Sekunde.

/** Fingerabdruck der Web-Rechnung (cardGarland.js) für dieselben Eingaben. */
const GARLAND_PARITY = 2695102931;

test("je Karte eine eigene Kette, die Begrüßungskarte behält ihre", () => {
  expect(edgePennants(360, 2027)).toEqual(edgePennants(360, 2027, "edge"));
  expect(edgePennants(360, 2027, "card:news-4")).not.toEqual(edgePennants(360, 2027));
  expect(edgeString(edgePennants(360, 2027), 360)).toMatch(/^M 0 1 L .* L 360 1$/);
});

test("Animation je Wimpel: wartet auf die Welle, schwingt, ruht - alles in einer Sekunde", () => {
  const first = pennantFrames(0, 18);
  const last = pennantFrames(17, 18);
  expect(first.inputRange[0]).toBe(0);
  expect(first.outputRange[1]).toBe("16deg");
  expect(last.inputRange[1]).toBeCloseTo((PENNANT_FLUTTER.ms - PENNANT_FLUTTER.each) / PENNANT_FLUTTER.ms, 4);
  expect(last.inputRange[last.inputRange.length - 1]).toBe(1);
  [first, last].forEach((frames) => frames.inputRange.slice(1).forEach((t, index) => expect(t).toBeGreaterThan(frames.inputRange[index])));
});

test("Parität mit dem Web: dieselben Zahlen, dieselben Wimpel - auch an der Begrüßungskarte", () => {
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
