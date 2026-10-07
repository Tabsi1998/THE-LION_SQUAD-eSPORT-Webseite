import { hashString } from "./rng";
import { EXTENT, buildPlan, planLines, toPixels } from "./webPlan";
import { TEAR, buildDelays, lineLength, tearPhase, tearPlan, type TearLine } from "./webTear";

// Netz reißt in der App (#1089): dieselbe Rechnung wie im Web (frontend/src/seasons/halloween/webTear.test.js) - Anker
// zuerst, dann der Rahmen, alles in gut einer halben Sekunde; ein Fetzen weht weg, der Rest löst sich auf; nach einer
// Minute Neubau Faden für Faden. Geprüft an echten Eck-Netzen der App und mit dem Fingerabdruck der Web-Rechnung.

/** Fingerabdruck der Web-Rechnung (frontend/src/seasons/halloween/webTear.js, Stand #1089) für dieselben Eingaben. */
const TEAR_PARITY = 2665017572;

function web(side: "tl" | "tr" = "tl", seed = 0.42, radius = 26) {
  const plan = buildPlan(seed);
  const mirror = side === "tr";
  return { lines: planLines(plan, radius, mirror), hub: toPixels(plan.nodes[0], radius, mirror), width: EXTENT.x * radius };
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
  // Die Nabe der rechten Ecke ist gespiegelt.
  expect(web("tr").hub.x).toBeCloseTo(web("tr").width - web("tl").hub.x, 5);
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
  expect(lineLength({ kind: "frame", x1: 0, y1: 0, x2: 3, y2: 4 })).toBe(5);
  // Ein Eck-Netz der App: jeder Faden kommt innerhalb der Bauzeit dran.
  const all = buildDelays(web().lines.length);
  expect(all[all.length - 1]).toBeLessThan(TEAR.buildMs);
});

test("Parität mit dem Web: dieselben Zahlen, dieselben Rollen, derselbe Flug", () => {
  const LINES: TearLine[] = [
    { kind: "anchor", x1: 0, y1: 0, x2: 16, y2: 17 },
    { kind: "anchor", x1: 16, y1: 17, x2: 30, y2: 30 },
    { kind: "anchor", x1: 58, y1: 0, x2: 45, y2: 12 },
    { kind: "frame", x1: 30, y1: 30, x2: 45, y2: 12 },
    { kind: "frame", x1: 45, y1: 12, x2: 56, y2: 40 },
    { kind: "frame", x1: 56, y1: 40, x2: 33, y2: 58 },
    { kind: "frame", x1: 33, y1: 58, x2: 12, y2: 44 },
    { kind: "frame", x1: 12, y1: 44, x2: 30, y2: 30 },
    { kind: "radius", x1: 32, y1: 35, x2: 45, y2: 12 },
    { kind: "radius", x1: 32, y1: 35, x2: 56, y2: 40 },
    { kind: "radius", x1: 32, y1: 35, x2: 33, y2: 58 },
    { kind: "radius", x1: 32, y1: 35, x2: 12, y2: 44 },
    { kind: "hubring", x1: 34, y1: 33, x2: 35, y2: 37 },
    { kind: "spiral", x1: 40, y1: 25, x2: 48, y2: 38 },
    { kind: "spiral", x1: 48, y1: 38, x2: 34, y2: 50 },
    { kind: "spiral", x1: 34, y1: 50, x2: 20, y2: 41 },
  ];
  const sample = {
    tear: TEAR,
    tl: tearPlan(LINES, { seed: "card:a:1", side: "tl", hub: { x: 32, y: 35 } }),
    tr: tearPlan(LINES, { seed: "card:b:2", side: "tr", hub: { x: 26, y: 35 } }),
    lengths: LINES.map(lineLength),
    delays: [buildDelays(16), buildDelays(10, 5000), buildDelays(0)],
    phases: [0, 2599, 2600, 59999, 60000, 65599, 65600].map(tearPhase),
  };
  expect(sample.tl.lines.map((entry) => entry.role).join(",")).toBe("snap,snap,snap,snap,scrap,scrap,scrap,snap,fade,scrap,scrap,fade,fade,scrap,scrap,fade");
  expect(sample.tl.scrap).toEqual({ dx: 31, dy: 110, turn: -29 });
  expect(sample.tr.scrap).toEqual({ dx: -59, dy: 81, turn: -23 });
  expect(hashString(JSON.stringify(sample))).toBe(TEAR_PARITY);
});
