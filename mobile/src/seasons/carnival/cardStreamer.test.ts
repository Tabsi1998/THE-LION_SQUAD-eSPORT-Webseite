import { hashString } from "../rng";
import { CARD_STREAMER, cardStreamerPlan, flutterAt, loopFrames, swingFrames } from "./cardStreamer";

// Eine Luftschlange auf der Kante einer Karte (#1093) - dieselbe Rechnung wie im Web
// (frontend/src/seasons/carnival/cardStreamer.test.js, derselbe Fingerabdruck): Schlaufen auf der Kante, das Ende außen
// über der Ecke; beim Antippen flattert sie einmal durch und liegt danach wie vorher.

/** Fingerabdruck der Web-Rechnung (cardStreamer.js) für dieselben Eingaben. */
const STREAMER_PARITY = 1678939084;

test("Animationen: jede Schlaufe wartet auf die Welle, hebt sich, liegt wieder; das Ende nur nach außen", () => {
  const first = loopFrames(0);
  expect(first.inputRange[0]).toBe(0);
  expect(first.outputRange[0]).toBe(1);
  expect(first.outputRange[first.outputRange.length - 1]).toBe(1);
  const third = loopFrames(2);
  expect(third.inputRange[1]).toBeCloseTo((2 * CARD_STREAMER.wave) / CARD_STREAMER.ms, 4);
  [first, third].forEach((frames) => frames.inputRange.slice(1).forEach((t, index) => expect(t).toBeGreaterThan(frames.inputRange[index])));
  const swing = swingFrames(-16);
  expect(swing.outputRange.every((value) => !value.startsWith("0") ? value.startsWith("-") : true)).toBe(true);
  const plan = cardStreamerPlan(300, "welle", { side: "right" });
  expect(flutterAt(CARD_STREAMER.ms, plan)).toEqual({ loops: plan.loops.map(() => 1), swing: 0 });
});

test("Parität mit dem Web: dieselben Zahlen, dieselben Luftschlangen", () => {
  const plan = cardStreamerPlan(354, "carnival:2027:Dashboard:1");
  const sample = {
    streamer: CARD_STREAMER,
    plans: [plan, cardStreamerPlan(612, "carnival:2027:/events:0", { side: "right" }), cardStreamerPlan(200, "kurz", { hang: false })],
    flutter: [0, 40, 130, 260, 333, 450, 600, 720, 900].map((ms) => flutterAt(ms, plan)),
  };
  expect(hashString(JSON.stringify(sample))).toBe(STREAMER_PARITY);
});
