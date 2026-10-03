import { streamerPath, streamerPlan } from "./geometry";

// Wo die Luftschlangen sitzen (Fasching F3 #747): je Seite und Jahr fest, ihre Form oben befestigt und nach unten
// gekräuselt. Wo der Hut sitzt, rechnet seit #855 das gemeinsame seasons/mascot (Tests dort).

test("Luftschlangen: je Seite ein bis zwei, fest je Jahr und Seite der Webseite, Maße im Rahmen", () => {
  const plan = streamerPlan(2027, "/");
  expect(streamerPlan(2027, "/")).toEqual(plan);
  expect(streamerPlan(2027, "/events")).not.toEqual(plan);
  expect(streamerPlan(2028, "/")).not.toEqual(plan);
  for (const side of ["left", "right"]) {
    const mine = plan.filter((streamer) => streamer.side === side);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine.length).toBeLessThanOrEqual(2);
    mine.forEach((streamer, index) => expect(streamer.index).toBe(index));
  }
  for (const streamer of plan) {
    expect(streamer.length).toBeGreaterThanOrEqual(70);
    expect(streamer.length).toBeLessThanOrEqual(150);
    expect(streamer.colors).toHaveLength(2);
    expect(streamer.sway).toBeGreaterThanOrEqual(4.5);
    expect(streamer.sway).toBeLessThanOrEqual(7);
  }
});

test("die Form: oben in der Mitte befestigt, unten so lang wie die Luftschlange, nach unten weiter schwingend", () => {
  const d = streamerPath({ length: 120, curl: 8, turns: 3 });
  expect(d.startsWith("M 12.0 0.0 L ")).toBe(true);
  const points = d.slice(2).split(" L ").map((pair) => pair.split(" ").map(Number));
  expect(points).toHaveLength(33);
  expect(points[32][1]).toBe(120);
  const reach = (from, to) => Math.max(...points.slice(from, to).map(([x]) => Math.abs(x - 12)));
  expect(reach(24, 33)).toBeGreaterThan(reach(0, 9));
  expect(reach(0, 33)).toBeLessThanOrEqual(8);
});
