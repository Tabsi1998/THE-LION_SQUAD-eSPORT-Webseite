import { hashString } from "../rng";
import { MELT, breakShards, catchStyle } from "./catch";

// Die gefangene Schneeflocke in der App (W5 #731): dieselbe Rechnung wie im Web - gleicher Fingerabdruck wie in
// frontend/src/seasons/snow/catch.test.js.

const CATCH_PARITY = 3673643042;

test("Frost bricht, Tauwetter schmilzt, dazwischen im Wechsel; ohne Temperatur bricht er", () => {
  expect([-10, 0].map((t) => catchStyle(t, 0))).toEqual(["break", "break"]);
  expect(catchStyle(4, 0)).toBe("melt");
  expect([0, 1].map((clicks) => catchStyle(1, clicks))).toEqual(["melt", "break"]);
  expect(catchStyle(null, 1)).toBe("break");
});

test("Parität mit dem Web: derselbe Fingerabdruck für Fangart und Splitter", () => {
  const sample = { styles: [-5, 0, 0.5, 1, 1.9, 2, 7, null].flatMap((t) => [0, 1, 2].map((c) => catchStyle(t, c))), shards: breakShards(), melt: MELT };
  expect(hashString(JSON.stringify(sample))).toBe(CATCH_PARITY);
});
