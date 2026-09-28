import { LEAF_COLORS, advanceLeaves, createLeaves, drawLeaf, spawnLeaf } from "./leaves";

// Herbstblätter (#658): wenige, langsam, mit Drall - unten raus heißt oben neu.

function rngOf(values) {
  let i = 0;
  return () => values[i++ % values.length];
}

test("Blätter starten verteilt, neue kommen von oben in einer Herbstfarbe", () => {
  const size = { width: 1000, height: 600 };
  const leaves = createLeaves(size, 4, rngOf([0.5]));
  expect(leaves.length).toBe(4);
  expect(leaves[0].y).toBe(300);
  const fresh = spawnLeaf(size, rngOf([0.2]));
  expect(fresh.y).toBe(-30);
  expect(LEAF_COLORS).toContain(fresh.color);
  expect(fresh.size).toBeGreaterThanOrEqual(9);
});

test("Blätter fallen, drehen sich und werden unten ersetzt", () => {
  const size = { width: 1000, height: 600 };
  const leaves = createLeaves(size, 2, rngOf([0.5]));
  const before = leaves.map((leaf) => ({ ...leaf }));
  advanceLeaves(leaves, 1, size, rngOf([0.5]));
  expect(leaves[0].y).toBeGreaterThan(before[0].y);
  leaves[0].y = size.height + 40;
  advanceLeaves(leaves, 0.1, size, rngOf([0.5]));
  expect(leaves[0].y).toBeLessThan(0);
});

test("Zeichnen: Blattform gefüllt, Mittelrippe als Strich", () => {
  const calls = [];
  const ctx = new Proxy({}, { get: (_t, name) => (["fillStyle", "strokeStyle", "lineWidth"].includes(name) ? "" : () => calls.push(name)) });
  drawLeaf(ctx, { x: 10, y: 20, size: 12, angle: 0.3, color: LEAF_COLORS[0] });
  expect(calls[0]).toBe("save");
  expect(calls.filter((name) => name === "fill").length).toBe(1);
  expect(calls.filter((name) => name === "stroke").length).toBe(1);
  expect(calls[calls.length - 1]).toBe("restore");
});
