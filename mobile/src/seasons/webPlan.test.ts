import { ANCHORS, EXTENT, RADII_CHOICES, RINGS_CHOICES, buildPlan, nodeId, planLines, spiderOrder, stepDurationMs, webRadius } from "./webPlan";

// Rundes Netz in der App (#665): derselbe Bauplan wie im Web - Anker, Rahmen, Speichen, Nabe, Spirale von außen
// nach innen, lückenlos; Speichen und Windungen aus dem Seed; alle Linien im Kasten; Schrittdauer nach Weg.

test("Bauplan: Reihenfolge, jeder Faden einmal, die Spinne springt nie", () => {
  const plan = buildPlan(0.42);
  const { radii, rings } = plan;
  expect(RADII_CHOICES).toContain(radii);
  expect(RINGS_CHOICES).toContain(rings);
  expect(plan.nodes.length).toBe(1 + radii * (rings + 1) + ANCHORS.length * 2);
  const spun = plan.order.filter((step) => !step.walk).map((step) => plan.threads[step.thread as number].kind);
  expect(spun[0]).toBe("anchor");
  expect(spun.filter((kind) => kind === "frame").length).toBe(radii);
  expect(spun.filter((kind) => kind === "radius").length).toBe(radii * (rings + 1));
  expect(spun.filter((kind) => kind === "spiral").length).toBe((rings - 1) * (radii - 1) + (rings - 2));
  expect(spun.lastIndexOf("frame")).toBeLessThan(spun.indexOf("radius"));
  expect(spun.lastIndexOf("hubring")).toBeLessThan(spun.indexOf("spiral"));
  expect(new Set(plan.order.filter((step) => !step.walk).map((step) => step.thread)).size).toBe(plan.threads.length);
  for (let n = 1; n < plan.order.length; n += 1) expect(plan.order[n].from).toBe(plan.order[n - 1].to);
  expect(buildPlan(0.42)).toEqual(plan);
});

test("Variation über Seeds, Speichen-Reihenfolge immer gegenüber", () => {
  const plans = [0.05, 0.13, 0.27, 0.42, 0.58, 0.66, 0.71, 0.84, 0.9, 0.97].map((seed) => buildPlan(seed));
  expect(new Set(plans.map((plan) => plan.radii)).size).toBeGreaterThan(1);
  expect(new Set(plans.map((plan) => plan.turn)).size).toBe(2);
  plans.forEach((plan) => {
    for (let n = 1; n < plan.order.length; n += 1) expect(plan.order[n].from).toBe(plan.order[n - 1].to);
  });
  RADII_CHOICES.forEach((radii) => {
    const order = spiderOrder(radii);
    expect(new Set(order).size).toBe(radii);
    expect(Math.abs(order[1] - order[0])).toBeGreaterThanOrEqual(radii / 2 - 2);
  });
});

test("Radius nach Screenbreite, Linien im Kasten, Schrittdauer nach Weg", () => {
  expect(webRadius(360)).toBe(58);
  expect(webRadius(800)).toBe(96);
  expect(webRadius(200)).toBe(44);
  const plan = buildPlan(0.42);
  const lines = planLines(plan, 60, false);
  expect(lines.length).toBe(plan.threads.length);
  lines.forEach((line) => {
    [line.x1, line.x2].forEach((x) => {
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(EXTENT.x * 60 + 0.5);
    });
    [line.y1, line.y2].forEach((y) => {
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThanOrEqual(EXTENT.y * 60 + 0.5);
    });
  });
  const mirrored = planLines(plan, 60, true);
  expect(mirrored[0].x1).toBeCloseTo(EXTENT.x * 60 - lines[0].x1, 5);
  const spinStep = plan.order.find((step) => !step.walk) as { from: number; to: number };
  const walkStep = plan.order.find((step) => step.walk) as { from: number; to: number };
  expect(stepDurationMs(plan, spinStep, 60)).toBeGreaterThanOrEqual(40);
  expect(stepDurationMs(plan, { ...walkStep, walk: true }, 60)).toBeLessThan(stepDurationMs(plan, { ...walkStep, walk: false }, 60));
  expect(nodeId(0, 0, plan.rings)).toBe(1);
});
