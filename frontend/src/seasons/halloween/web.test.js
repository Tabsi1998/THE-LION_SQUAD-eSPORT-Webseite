import { ANCHORS, EXTENT, HUB, RADII_CHOICES, RINGS_CHOICES, advanceBuild, advanceIdle, applyImpulse, buildPlan, createSim, createWebLayer, nodeId, resizeSim, spiderOrder, staticLines, stepPhysics, webRadius } from "./web";

// Rundes Netz (#660, #670): Bauplan in echter Reihenfolge mit Speichen, Windungen und Drehsinn aus dem Seed, die
// Spinne springt nie; während des Baus steht alles fest, danach schwingt es; Physik reagiert auf Zeiger und Stoß,
// bleibt aber in Form (Rückstellung, begrenzte Schritte); Größe ändern behält den Fortschritt; SVG ganz im Kasten.

function fakeContext(calls) {
  return new Proxy({}, { get: (_t, name) => (["fillStyle", "strokeStyle", "lineWidth", "lineCap"].includes(name) ? "" : () => calls.push(name)) });
}

test("Bauplan: Anker zuerst, dann Rahmen, Speichen, Nabe, Fangspirale von außen nach innen - jeder Faden einmal, lückenlos", () => {
  const plan = buildPlan(0.42);
  const { radii, rings } = plan;
  expect(RADII_CHOICES).toContain(radii);
  expect(RINGS_CHOICES).toContain(rings);
  expect(plan.nodes.length).toBe(1 + radii * (rings + 1) + ANCHORS.length * 2);
  const spun = plan.order.filter((step) => !step.walk).map((step) => plan.threads[step.thread].kind);
  expect(spun[0]).toBe("anchor");
  expect(spun.filter((kind) => kind === "anchor").length).toBe(ANCHORS.length * 2);
  expect(spun.filter((kind) => kind === "frame").length).toBe(radii);
  expect(spun.filter((kind) => kind === "radius").length).toBe(radii * (rings + 1));
  expect(spun.filter((kind) => kind === "hubring").length).toBe(radii);
  expect(spun.filter((kind) => kind === "spiral").length).toBe((rings - 1) * (radii - 1) + (rings - 2));
  expect(spun.lastIndexOf("frame")).toBeLessThan(spun.indexOf("radius"));
  expect(spun.lastIndexOf("radius")).toBeLessThan(spun.indexOf("hubring"));
  expect(spun.lastIndexOf("hubring")).toBeLessThan(spun.indexOf("spiral"));
  const firstSpiral = plan.order.find((step) => !step.walk && plan.threads[step.thread].kind === "spiral");
  expect(plan.nodes[firstSpiral.from].k).toBe(rings - 1);
  const threads = plan.order.filter((step) => !step.walk).map((step) => step.thread);
  expect(new Set(threads).size).toBe(plan.threads.length);
  for (let n = 1; n < plan.order.length; n += 1) expect(plan.order[n].from).toBe(plan.order[n - 1].to);
  expect(plan.dew.length).toBe(7);
  expect(buildPlan(0.42)).toEqual(plan);
});

test("Variation: verschiedene Seeds geben verschiedene Speichenzahlen, Windungen und Drehsinn - alle lückenlos", () => {
  const seeds = [0.05, 0.13, 0.27, 0.42, 0.58, 0.66, 0.71, 0.84, 0.9, 0.97];
  const plans = seeds.map((seed) => buildPlan(seed));
  expect(new Set(plans.map((plan) => plan.radii)).size).toBeGreaterThan(1);
  expect(new Set(plans.map((plan) => plan.rings)).size).toBeGreaterThan(1);
  expect(new Set(plans.map((plan) => plan.turn)).size).toBe(2);
  plans.forEach((plan) => {
    for (let n = 1; n < plan.order.length; n += 1) expect(plan.order[n].from).toBe(plan.order[n - 1].to);
    expect(new Set(plan.order.filter((step) => !step.walk).map((step) => step.thread)).size).toBe(plan.threads.length);
  });
  RADII_CHOICES.forEach((radii) => {
    const order = spiderOrder(radii);
    expect(new Set(order).size).toBe(radii);
    expect(Math.abs(order[1] - order[0])).toBeGreaterThanOrEqual(radii / 2 - 2);
  });
});

test("Radius: 56 bis 150 Pixel nach Fensterbreite, mal Seitenfaktor", () => {
  expect(webRadius(390)).toBe(56);
  expect(webRadius(1366)).toBe(116);
  expect(webRadius(1920)).toBe(150);
  expect(webRadius(1366, 0.5)).toBe(58);
});

test("Bau: alles steht fest, die Spinne sitzt am Fadenende, am Ende ist alles da und das Netz wird frei", () => {
  const plan = buildPlan(0.42);
  const sim = createSim(plan, { radius: 100, origin: { x: 0, y: 0 } });
  expect(sim.done).toBe(false);
  expect(sim.threads.every((thread) => thread.built === 0)).toBe(true);
  expect(sim.nodes.every((node) => node.pinned)).toBe(true);
  const start = sim.nodes[plan.order[0].from];
  expect(sim.spider).toMatchObject({ x: start.x, y: start.y });
  advanceBuild(sim, 0.3);
  expect(sim.threads[0].built).toBeGreaterThan(0);
  expect(sim.threads[0].built).toBeLessThan(1);
  const a = sim.nodes[sim.threads[0].a];
  const b = sim.nodes[sim.threads[0].b];
  expect(sim.spider.x).toBeCloseTo(a.x + (b.x - a.x) * sim.threads[0].built, 5);
  // Während des Baus bewegt die Physik nichts - die Fäden bleiben straff.
  const frameNode = sim.nodes[nodeId(0, plan.rings, plan.rings)];
  const before = { x: frameNode.x, y: frameNode.y };
  for (let n = 0; n < 30; n += 1) stepPhysics(sim, 1 / 60);
  expect(frameNode).toMatchObject(before);
  for (let n = 0; n < 600; n += 1) advanceBuild(sim, 0.5);
  expect(sim.done).toBe(true);
  expect(sim.threads.every((thread) => thread.built === 1)).toBe(true);
  expect(sim.nodes.filter((node) => node.anchor).every((node) => node.pinned)).toBe(true);
  expect(sim.nodes.filter((node) => !node.anchor).every((node) => !node.pinned)).toBe(true);
  expect(sim.spider).toMatchObject({ x: sim.nodes[0].x, y: sim.nodes[0].y });
});

test("Fertig: die Spinne rastet und geht nach der Pause eine Speiche hinaus und zurück", () => {
  const sim = createSim(buildPlan(0.42), { radius: 100, origin: { x: 0, y: 0 }, prebuilt: true });
  const hub = { x: sim.nodes[0].x, y: sim.nodes[0].y };
  advanceIdle(sim, 1, () => 0.5);
  expect(sim.spider).toMatchObject(hub);
  expect(sim.patrol).toBeNull();
  for (let n = 0; n < 50; n += 1) advanceIdle(sim, 1, () => 0.5);
  expect(sim.patrol).not.toBeNull();
  expect(sim.spider.moving).toBe(true);
  for (let n = 0; n < 200; n += 1) advanceIdle(sim, 0.1, () => 0.5);
  expect(sim.patrol).toBeNull();
  expect(sim.spider.moving).toBe(false);
  expect(sim.spider.x).toBeCloseTo(hub.x, 3);
});

test("Physik: der Zeiger schiebt Knoten beiseite, sie kehren zurück; ein Stoß hebt das Netz; Anker bleiben, Fäden halten", () => {
  const plan = buildPlan(0.42);
  const control = createSim(plan, { radius: 100, origin: { x: 0, y: 0 }, prebuilt: true });
  const sim = createSim(plan, { radius: 100, origin: { x: 0, y: 0 }, prebuilt: true });
  const id = nodeId(3, 4, plan.rings);
  const node = sim.nodes[id];
  const pointer = { x: node.x + 10, y: node.y };
  // Alle Knoten im Umkreis rücken im Schnitt vom Zeiger weg - eine Delle im Netz, kein einzelner Ausreißer.
  const nearby = sim.nodes.map((entry, index) => ({ index, d: Math.hypot(entry.x - pointer.x, entry.y - pointer.y) })).filter((entry) => entry.d < 42 && !sim.nodes[entry.index].pinned);
  expect(nearby.length).toBeGreaterThan(5);
  sim.pointer = pointer;
  for (let n = 0; n < 10; n += 1) stepPhysics(sim, 1 / 60);
  const pushed = nearby.map((entry) => Math.hypot(sim.nodes[entry.index].x - pointer.x, sim.nodes[entry.index].y - pointer.y) - entry.d);
  expect(pushed.reduce((sum, value) => sum + value, 0) / pushed.length).toBeGreaterThan(0.8);
  sim.pointer = null;
  for (let n = 0; n < 300; n += 1) {
    stepPhysics(sim, 1 / 60);
    stepPhysics(control, 1 / 60);
  }
  expect(Math.abs(node.x - control.nodes[id].x)).toBeLessThan(2);
  expect(Math.abs(node.y - control.nodes[id].y)).toBeLessThan(2);
  expect(sim.nodes.filter((entry) => entry.anchor).every((entry) => entry.pinned)).toBe(true);
  const hubY = sim.nodes[0].y;
  applyImpulse(sim, 0, -8);
  stepPhysics(sim, 1 / 60);
  expect(sim.nodes[0].y).toBeLessThan(hubY);
  const worst = sim.threads.reduce((max, thread) => {
    const a = sim.nodes[thread.a];
    const b = sim.nodes[thread.b];
    return Math.max(max, Math.abs(Math.hypot(b.x - a.x, b.y - a.y) - thread.rest) / thread.rest);
  }, 0);
  expect(worst).toBeLessThan(0.3);
});

test("Kein Knäuel: viele Scroll-Stöße hintereinander verformen das Netz nur wenig, es kehrt in seine Form zurück", () => {
  const plan = buildPlan(0.42);
  const sim = createSim(plan, { radius: 120, origin: { x: 0, y: 0 }, prebuilt: true });
  for (let n = 0; n < 40; n += 1) {
    applyImpulse(sim, 0, -30 * 0.12);
    applyImpulse(sim, 0, -30 * 0.12);
    applyImpulse(sim, 0, -30 * 0.12);
    stepPhysics(sim, 1 / 60);
  }
  const drift = (node) => Math.hypot(node.x - node.rx, node.y - node.ry);
  const worstDuring = Math.max(...sim.nodes.map(drift));
  expect(worstDuring).toBeLessThan(0.3 * 120);
  for (let n = 0; n < 240; n += 1) stepPhysics(sim, 1 / 60);
  expect(Math.max(...sim.nodes.map(drift))).toBeLessThan(6);
});

test("Größe ändern: der Fortschritt bleibt, die Positionen folgen dem neuen Radius", () => {
  const plan = buildPlan(0.42);
  const sim = createSim(plan, { radius: 100, origin: { x: 0, y: 0 } });
  advanceBuild(sim, 20);
  const built = sim.threads.filter((thread) => thread.built === 1).length;
  expect(built).toBeGreaterThan(5);
  resizeSim(sim, { radius: 150, origin: { x: 0, y: 0 } });
  expect(sim.threads.filter((thread) => thread.built === 1).length).toBe(built);
  expect(sim.nodes[0].x).toBeCloseTo(HUB.x * 150, 5);
  expect(sim.nodes[0].y).toBeCloseTo(HUB.y * 150, 5);
  expect(sim.nodes[0].rx).toBeCloseTo(HUB.x * 150, 5);
});

test("Statisches Netz: alle Linien liegen im Kasten, rechts gespiegelt", () => {
  const plan = buildPlan(0.42);
  const lines = staticLines(plan, 100, false);
  expect(lines.length).toBe(plan.threads.length);
  lines.forEach((line) => {
    [line.x1, line.x2].forEach((x) => {
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(EXTENT.x * 100 + 0.5);
    });
    [line.y1, line.y2].forEach((y) => {
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeLessThanOrEqual(EXTENT.y * 100 + 0.5);
    });
  });
  const mirrored = staticLines(plan, 100, true);
  expect(mirrored[0].x1).toBeCloseTo(EXTENT.x * 100 - lines[0].x1, 5);
  expect(mirrored[0].y1).toBeCloseTo(lines[0].y1, 5);
});

test("Ebene: zeichnet auf dem Canvas, hört auf Zeiger und Scrollen, räumt beim Entfernen auf", () => {
  const listeners = {};
  const win = { innerWidth: 1200, scrollY: 0, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: (name) => { delete listeners[name]; } };
  const layer = createWebLayer({ seed: 0.42, corner: "tr", factor: 1, build: false }, win);
  expect(layer.key).toBe("halloween-web-tr");
  const calls = [];
  const ctx = fakeContext(calls);
  layer.draw(ctx, 1 / 60, { width: 1200, height: 800 });
  expect(calls.filter((name) => name === "stroke").length).toBeGreaterThanOrEqual(3);
  expect(calls.filter((name) => name === "fill").length).toBeGreaterThan(0);
  expect(layer.sim.mirror).toBe(true);
  expect(layer.sim.done).toBe(true);
  expect(layer.sim.origin.x).toBe(1200);
  listeners.mousemove({ clientX: 10, clientY: 10 });
  win.scrollY = 120;
  listeners.scroll();
  expect(layer.sim.impulse.y).toBeCloseTo(-30 * 0.05, 5);
  win.scrollY = 240;
  listeners.scroll();
  expect(layer.sim.impulse.y).toBeCloseTo(-30 * 0.05, 5);
  layer.draw(ctx, 1 / 60, { width: 1000, height: 800 });
  expect(layer.sim.origin.x).toBe(1000);
  layer.dispose();
  expect(Object.keys(listeners)).toEqual([]);
  const building = createWebLayer({ seed: 0.1, corner: "tl", factor: 1, build: true }, win);
  building.draw(ctx, 1 / 60, { width: 1200, height: 800 });
  expect(building.sim.done).toBe(false);
  building.dispose();
});

test("Wetter (#666): der Wind aus dem Start und aus dem Ereignis skaliert und richtet den Netzwind", () => {
  const listeners = {};
  const win = { innerWidth: 1200, scrollY: 0, addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: (name) => { delete listeners[name]; } };
  const layer = createWebLayer({ seed: 0.42, corner: "tl", factor: 1, build: false, weather: { wind_factor: 1.2, wind_dir: 90 } }, win);
  expect(layer.wind).toEqual({ scale: 2, sign: -1 });
  listeners["tls:season-weather"]({ detail: { wind_factor: 0.3, wind_dir: 270 } });
  expect(layer.wind).toEqual({ scale: 0.5, sign: 1 });
  listeners["tls:season-weather"]({ detail: null });
  expect(layer.wind).toEqual({ scale: 0.5, sign: 1 });
  const calls = [];
  layer.draw(fakeContext(calls), 1 / 60, { width: 1200, height: 800 });
  expect(layer.sim.wind.x).toBeGreaterThan(0);
  layer.dispose();
  expect(Object.keys(listeners)).toEqual([]);
});
