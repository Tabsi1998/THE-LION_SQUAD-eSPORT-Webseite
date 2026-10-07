import { buildPlan, staticLines } from "./web";
import { TEAR, buildDelays, lineLength, tearPhase, tearPlan } from "./webTear";
import { hubOf, webSpec } from "./webCorners";

// Netz reißt (#1089): Anker zuerst, dann der Rahmen, alles in gut einer halben Sekunde; ein Fetzen weht weg, der Rest
// löst sich auf; nach einer Minute Neubau Faden für Faden. Drei Vorgänge, keine Standbilder.

function web(side = "tl", seed = "0.42") {
  const spec = webSpec(seed);
  const lines = staticLines(buildPlan(spec.seed), spec.radius, side === "tr");
  return { spec, lines, hub: hubOf(spec, side) };
}

test("Anker reißen zuerst, der Rahmen danach - alles innerhalb von gut einer halben Sekunde", () => {
  const { lines, hub } = web();
  const plan = tearPlan(lines, { seed: "a", side: "tl", hub });
  expect(plan.lines).toHaveLength(lines.length);
  const snaps = plan.lines.filter((entry) => entry.role === "snap");
  const anchorDelays = snaps.filter((entry) => lines[entry.index].kind === "anchor").map((entry) => entry.delay);
  const frameDelays = snaps.filter((entry) => lines[entry.index].kind !== "anchor").map((entry) => entry.delay);
  expect(anchorDelays.length).toBeGreaterThan(0);
  expect(Math.max(...anchorDelays)).toBeLessThanOrEqual(Math.min(...frameDelays, Infinity));
  snaps.forEach((entry) => expect(entry.delay + TEAR.snapEachMs).toBeLessThanOrEqual(TEAR.snapMs));
  // Ein Fetzen und ein Rest: beide nicht leer.
  expect(plan.lines.some((entry) => entry.role === "scrap")).toBe(true);
  expect(plan.lines.some((entry) => entry.role === "fade")).toBe(true);
  plan.lines.forEach((entry) => expect(entry.length).toBeGreaterThan(0));
});

test("der Fetzen fliegt von der Ecke weg und nach unten; gleiche Saat gleicher Flug", () => {
  const left = tearPlan(web("tl").lines, { seed: "s", side: "tl", hub: web("tl").hub });
  const right = tearPlan(web("tr").lines, { seed: "s", side: "tr", hub: web("tr").hub });
  expect(left.scrap.dx).toBeGreaterThan(0);
  expect(right.scrap.dx).toBeLessThan(0);
  expect(left.scrap.dy).toBeGreaterThanOrEqual(TEAR.scrapDy[0]);
  expect(Math.abs(left.scrap.turn)).toBeGreaterThanOrEqual(TEAR.scrapTurn[0]);
  expect(tearPlan(web("tl").lines, { seed: "s", side: "tl", hub: web("tl").hub })).toEqual(left);
});

test("Phasen: reißen, weg, Neubau nach einer Minute, fertig", () => {
  expect(tearPhase(0)).toBe("tear");
  expect(tearPhase(TEAR.goneAt - 1)).toBe("tear");
  expect(tearPhase(TEAR.goneAt)).toBe("gone");
  expect(tearPhase(TEAR.rebuildAt - 1)).toBe("gone");
  expect(tearPhase(TEAR.rebuildAt)).toBe("build");
  expect(tearPhase(TEAR.rebuildAt + TEAR.buildMs + 400)).toBe("done");
});

test("Neubau: gleichmäßig über die Bauzeit, in der Reihenfolge des Plans", () => {
  const delays = buildDelays(10, 5000);
  expect(delays[0]).toBe(0);
  expect(delays[9]).toBe(4500);
  expect([...delays].sort((a, b) => a - b)).toEqual(delays);
  expect(buildDelays(0)).toEqual([]);
  expect(lineLength({ x1: 0, y1: 0, x2: 3, y2: 4 })).toBe(5);
});
