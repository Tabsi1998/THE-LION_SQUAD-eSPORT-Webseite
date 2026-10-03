import { hashString } from "../rng";
import { MELT, MELT_FROM_C, breakShards, catchStyle } from "./catch";

// Die gefangene Schneeflocke (W5 #731): bei Frost bricht der Kristall, bei Tauwetter schmilzt er, dazwischen wechselt
// es; die Splitter fliegen entlang der Arme. Die App rechnet dasselbe (gleicher Fingerabdruck in catch.test.ts).

const CATCH_PARITY = 3673643042;

test("Frost bricht, Tauwetter schmilzt, dazwischen im Wechsel; ohne Temperatur bricht er", () => {
  expect([-10, -0.5, 0].map((t) => catchStyle(t, 0))).toEqual(["break", "break", "break"]);
  expect([MELT_FROM_C, 6].map((t) => catchStyle(t, 3))).toEqual(["melt", "melt"]);
  expect([0, 1, 2, 3].map((clicks) => catchStyle(1, clicks))).toEqual(["melt", "break", "melt", "break"]);
  expect([null, undefined, "", "x"].map((t) => catchStyle(t, 1))).toEqual(["break", "break", "break", "break"]);
});

test("Splitter: sechs lange entlang der Arme (0°, 60° …), sechs kleine dazwischen; fliegen nach außen", () => {
  const shards = breakShards();
  const slivers = shards.filter((shard) => shard.kind === "sliver");
  const chips = shards.filter((shard) => shard.kind === "chip");
  expect(slivers.map((shard) => shard.angle)).toEqual([0, 60, 120, 180, 240, 300]);
  expect(chips.map((shard) => shard.angle)).toEqual([30, 90, 150, 210, 270, 330]);
  // Der erste Arm zeigt nach oben: sein Splitter fliegt nach oben.
  expect(slivers[0].dx).toBeCloseTo(0, 5);
  expect(slivers[0].dy).toBeLessThan(-10);
  slivers.forEach((shard) => expect(Math.hypot(shard.dx, shard.dy)).toBeGreaterThan(14.9));
  expect(MELT.fall).toBeGreaterThan(5);
});

test("Parität mit der App: derselbe Fingerabdruck für Fangart und Splitter", () => {
  const sample = { styles: [-5, 0, 0.5, 1, 1.9, 2, 7, null].flatMap((t) => [0, 1, 2].map((c) => catchStyle(t, c))), shards: breakShards(), melt: MELT };
  expect(hashString(JSON.stringify(sample))).toBe(CATCH_PARITY);
});
