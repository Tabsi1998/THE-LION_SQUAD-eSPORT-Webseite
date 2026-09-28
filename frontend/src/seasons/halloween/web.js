// Rundes Netz mit Physik (#660): ein Bauplan in der Reihenfolge einer echten Radnetzspinne (Ankerfäden und
// Rahmen, Speichen, Nabe, Fangspirale von außen nach innen), Verlet-Physik für jeden Faden (Zeiger stupst an,
// Scrollen gibt einen Stoß, Wind bewegt), Zeichnen auf dem gemeinsamen Canvas samt Spinne, die man beim
// Spinnen zuschauen kann - und ein statisches SVG für „dezent“ und „Bewegung reduzieren“.
// Der Plan rechnet in Nabe-Koordinaten mit Radius 1, erst die Simulation rechnet in Pixel um. Kein Paket.
import { hashString, mulberry32 } from "../rng";

export const RADII = 16;
export const RINGS = 9;
export const SPIN_SPEED = 70;
export const WALK_SPEED = 130;
/** Ausdehnung des ganzen Netzes samt Ankerfäden in Radien, von der Ecke aus. */
export const EXTENT = { x: 2.32, y: 2.42 };
/** Die Nabe sitzt hier, von der Ecke aus gemessen (in Radien). */
export const HUB = { x: 1.25, y: 1.35 };
/** Anker relativ zur Nabe: die Ecke, die obere Kante, die seitliche Kante. */
export const ANCHORS = [[-1.25, -1.35], [1.07, -1.35], [-1.25, 1.07]];
export const THREAD_MAIN = "rgba(170, 225, 240, 0.62)";
export const THREAD_FINE = "rgba(170, 225, 240, 0.44)";
export const THREAD_GLOW = "rgba(170, 225, 240, 0.10)";
const HUB_RING = 0.12;
const FIRST_RING = 0.24;
const LAST_RING = 0.9;
const RADIUS_ORDER = [0, 8, 4, 12, 2, 10, 6, 14, 1, 9, 5, 13, 3, 11, 7, 15];
const GRAVITY = 40;
const DAMPING = 0.985;
const STIFFNESS = { anchor: 0.85, frame: 0.85, radius: 0.8, hubring: 0.7, spiral: 0.55 };
const POINTER_RADIUS = 42;
const POINTER_PUSH = 2.2;

export function nodeId(i, k) {
  return 1 + i * (RINGS + 1) + k;
}

function ringRadius(k) {
  if (k <= 0) return HUB_RING;
  return FIRST_RING + ((k - 1) / (RINGS - 2)) * (LAST_RING - FIRST_RING);
}

function angleDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

/** Radius in Pixel für eine Fensterbreite: 56–150 px, mal Seitenfaktor. */
export function webRadius(width, factor = 1) {
  return Math.round(Math.max(56, Math.min(150, width * 0.085)) * factor);
}

/**
 * Bauplan: Knoten (Einheitsradius, Nabe im Ursprung), Fäden mit Art und Ruhelänge, Reihenfolge des Baus als
 * Schritte { thread, from, to } (Faden spinnen) oder { walk: true, from, to } (nur laufen).
 */
export function buildPlan(seed = 0.37) {
  const rng = mulberry32(hashString(`web:${seed}`));
  const nodes = [{ x: 0, y: 0, kind: "hub" }];
  const angles = [];
  const frame = [];
  for (let i = 0; i < RADII; i += 1) {
    angles.push(-Math.PI / 2 + (i / RADII) * Math.PI * 2 + (rng() - 0.5) * 0.12);
    frame.push(0.95 + rng() * 0.1);
  }
  for (let i = 0; i < RADII; i += 1) {
    for (let k = 0; k <= RINGS; k += 1) {
      let r;
      if (k === RINGS) r = frame[i];
      else if (k === 0) r = HUB_RING;
      else {
        const next = k < RINGS - 1 ? ringRadius(k + 1) : Math.min(frame[i] - 0.05, LAST_RING + 0.05);
        r = ringRadius(k) + (i / RADII) * (next - ringRadius(k));
      }
      nodes.push({ x: Math.cos(angles[i]) * r, y: Math.sin(angles[i]) * r, kind: k === RINGS ? "frame" : k === 0 ? "hubring" : "spiral", i, k });
    }
  }
  const threads = [];
  const order = [];
  const add = (kind, a, b) => {
    threads.push({ kind, a, b, rest: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) });
    return threads.length - 1;
  };
  const spin = (kind, a, b) => order.push({ thread: add(kind, a, b), from: a, to: b });
  const walk = (from, to) => order.push({ walk: true, from, to });

  // Ankerpunkte samt Zwischenknoten, je nächster Rahmenknoten
  const anchorAt = ANCHORS.map(([ax, ay]) => {
    const angle = Math.atan2(ay, ax);
    let best = 0;
    for (let i = 1; i < RADII; i += 1) if (angleDiff(angles[i], angle) < angleDiff(angles[best], angle)) best = i;
    const mid = nodes.push({ x: (nodes[nodeId(best, RINGS)].x + ax) / 2, y: (nodes[nodeId(best, RINGS)].y + ay) / 2, kind: "mid" }) - 1;
    const anchor = nodes.push({ x: ax, y: ay, kind: "anchor", pinned: true }) - 1;
    return { frame: best, mid, anchor };
  });

  // 1. Von der Ecke aus der erste Ankerfaden, dann der Rahmen einmal herum - an den anderen beiden Ankern
  //    geht ein Faden zur Kante und die Spinne kommt zurück.
  const [first, second, third] = anchorAt;
  spin("anchor", first.anchor, first.mid);
  spin("anchor", first.mid, nodeId(first.frame, RINGS));
  const framePath = [];
  for (let n = 1; n <= RADII; n += 1) framePath.push((first.frame + n) % RADII);
  let at = first.frame;
  framePath.forEach((next) => {
    spin("frame", nodeId(at, RINGS), nodeId(next, RINGS));
    at = next;
    [second, third].forEach((entry) => {
      if (entry.frame !== at) return;
      spin("anchor", nodeId(at, RINGS), entry.mid);
      spin("anchor", entry.mid, entry.anchor);
      walk(entry.anchor, entry.mid);
      walk(entry.mid, nodeId(at, RINGS));
    });
  });

  // 2. Speichen: die erste vom Rahmen zur Nabe, alle weiteren von der Nabe nach außen und zurück.
  const firstRadius = first.frame;
  for (let k = RINGS; k > 0; k -= 1) spin("radius", nodeId(firstRadius, k), nodeId(firstRadius, k - 1));
  spin("radius", nodeId(firstRadius, 0), 0);
  RADIUS_ORDER.filter((i) => i !== firstRadius).forEach((i) => {
    spin("radius", 0, nodeId(i, 0));
    for (let k = 0; k < RINGS; k += 1) spin("radius", nodeId(i, k), nodeId(i, k + 1));
    for (let k = RINGS; k > 0; k -= 1) walk(nodeId(i, k), nodeId(i, k - 1));
    walk(nodeId(i, 0), 0);
  });

  // 3. Die Nabe: ein kleiner Ring um die Mitte.
  walk(0, nodeId(0, 0));
  for (let i = 0; i < RADII; i += 1) spin("hubring", nodeId(i, 0), nodeId((i + 1) % RADII, 0));

  // 4. Fangspirale von außen nach innen: erst hinauslaufen, dann Windung für Windung zur Nabe.
  const outer = RINGS - 1;
  walk(nodeId(0, 0), nodeId(RADII - 1, 0));
  for (let k = 0; k < outer; k += 1) walk(nodeId(RADII - 1, k), nodeId(RADII - 1, k + 1));
  for (let k = outer; k >= 1; k -= 1) {
    for (let i = RADII - 1; i >= 0; i -= 1) {
      if (i === RADII - 1) {
        if (k === outer) continue;
        spin("spiral", nodeId(0, k + 1), nodeId(RADII - 1, k));
      } else {
        spin("spiral", nodeId(i + 1, k), nodeId(i, k));
      }
    }
  }
  walk(nodeId(0, 1), nodeId(0, 0));
  walk(nodeId(0, 0), 0);

  const dew = [];
  const dewRng = mulberry32(hashString(`dew:${seed}`));
  for (let n = 0; n < 7; n += 1) dew.push(nodeId(Math.floor(dewRng() * RADII), 2 + Math.floor(dewRng() * (RINGS - 3))));
  return { nodes, threads, order, dew, seed };
}

/** Knotenposition in Pixel: Ecke als Ursprung, `mirror` spiegelt für die rechte Ecke. */
export function toPixels(node, radius, mirror = false, origin = { x: 0, y: 0 }) {
  const x = (HUB.x + node.x) * radius;
  const y = (HUB.y + node.y) * radius;
  return { x: origin.x + (mirror ? -x : x), y: origin.y + y };
}

/** Linien für das statische SVG (alle Fäden fertig), im Kasten EXTENT × Radius mit der Ecke oben links. */
export function staticLines(plan, radius, mirror = false) {
  const origin = { x: mirror ? EXTENT.x * radius : 0, y: 0 };
  return plan.threads.map((thread) => {
    const a = toPixels(plan.nodes[thread.a], radius, mirror, origin);
    const b = toPixels(plan.nodes[thread.b], radius, mirror, origin);
    return { kind: thread.kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
}

/** Die Simulation in Pixel: Knoten mit Vorposition (Verlet), Fäden mit Ruhelänge und Baufortschritt. */
export function createSim(plan, { radius, origin, mirror = false, prebuilt = false }) {
  const nodes = plan.nodes.map((node) => {
    const p = toPixels(node, radius, mirror, origin);
    return { x: p.x, y: p.y, px: p.x, py: p.y, anchor: Boolean(node.pinned), pinned: true, links: 0 };
  });
  const threads = plan.threads.map((thread) => ({ ...thread, rest: thread.rest * radius, built: 0 }));
  const sim = { plan, nodes, threads, radius, origin, mirror, step: 0, t: 0, done: false, pointer: null, wind: { x: 0, y: 0 }, spider: { x: nodes[0].x, y: nodes[0].y, heading: 0, phase: 0, moving: false }, idle: 45, patrol: null };
  if (prebuilt) {
    threads.forEach((thread) => finishThread(sim, thread));
    sim.step = plan.order.length;
    sim.done = true;
    sim.spider.x = nodes[0].x;
    sim.spider.y = nodes[0].y;
  } else {
    const start = nodes[plan.order[0].from];
    sim.spider.x = start.x;
    sim.spider.y = start.y;
  }
  return sim;
}

function finishThread(sim, thread) {
  if (thread.built >= 1) return;
  thread.built = 1;
  [thread.a, thread.b].forEach((id) => {
    const node = sim.nodes[id];
    node.links += 1;
    if (!node.anchor && node.links >= 2) node.pinned = false;
  });
}

/** Neue Größe: alle Ruhepositionen neu, Baufortschritt bleibt. */
export function resizeSim(sim, { radius, origin }) {
  sim.radius = radius;
  sim.origin = origin;
  sim.plan.nodes.forEach((node, id) => {
    const p = toPixels(node, radius, sim.mirror, origin);
    Object.assign(sim.nodes[id], { x: p.x, y: p.y, px: p.x, py: p.y });
  });
  sim.threads.forEach((thread, index) => {
    thread.rest = sim.plan.threads[index].rest * radius;
  });
  const item = sim.plan.order[Math.min(sim.step, sim.plan.order.length - 1)];
  const at = sim.nodes[sim.done ? 0 : item.from];
  sim.spider.x = at.x;
  sim.spider.y = at.y;
}

/** Bau um dt Sekunden weiter: die Spinne läuft, der aktuelle Faden wächst hinter ihr her. */
export function advanceBuild(sim, dt) {
  let remaining = dt;
  while (remaining > 0 && !sim.done) {
    const item = sim.plan.order[sim.step];
    const from = sim.nodes[item.from];
    const to = sim.nodes[item.to];
    const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
    const speed = item.walk ? WALK_SPEED : SPIN_SPEED;
    const need = ((1 - sim.t) * length) / speed;
    const used = Math.min(remaining, need);
    sim.t += (used * speed) / length;
    remaining -= used;
    sim.spider.x = from.x + (to.x - from.x) * sim.t;
    sim.spider.y = from.y + (to.y - from.y) * sim.t;
    sim.spider.heading = Math.atan2(to.y - from.y, to.x - from.x);
    sim.spider.moving = true;
    sim.spider.phase += used * 22;
    // Erst finishThread setzt 1 und zählt die Verbindungen - sonst bliebe der Knoten für immer festgenagelt.
    if (!item.walk) sim.threads[item.thread].built = Math.min(0.999, sim.t);
    if (sim.t >= 1 - 1e-6) {
      if (!item.walk) finishThread(sim, sim.threads[item.thread]);
      sim.step += 1;
      sim.t = 0;
      if (sim.step >= sim.plan.order.length) {
        sim.done = true;
        sim.spider.moving = false;
      }
    }
  }
}

/** Fertiges Netz: die Spinne sitzt in der Nabe, atmet, und geht alle 40–90 s einmal eine Speiche hinaus und zurück. */
export function advanceIdle(sim, dt, rng = Math.random) {
  const spider = sim.spider;
  if (!sim.patrol) {
    sim.idle -= dt;
    spider.phase += dt * 1.5;
    if (sim.idle > 0) return;
    const radius = Math.floor(rng() * RADII);
    const path = [];
    for (let k = 0; k <= RINGS; k += 1) path.push(nodeId(radius, k));
    sim.patrol = { path: [0, ...path, ...path.slice().reverse(), 0], index: 0, t: 0 };
    sim.idle = 40 + rng() * 50;
  }
  const patrol = sim.patrol;
  const from = sim.nodes[patrol.path[patrol.index]];
  const to = sim.nodes[patrol.path[patrol.index + 1]];
  const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
  patrol.t += (dt * WALK_SPEED * 0.55) / length;
  spider.moving = true;
  spider.phase += dt * 16;
  spider.heading = Math.atan2(to.y - from.y, to.x - from.x);
  spider.x = from.x + (to.x - from.x) * Math.min(1, patrol.t);
  spider.y = from.y + (to.y - from.y) * Math.min(1, patrol.t);
  if (patrol.t >= 1) {
    patrol.index += 1;
    patrol.t = 0;
    if (patrol.index >= patrol.path.length - 1) {
      sim.patrol = null;
      spider.moving = false;
    }
  }
}

/** Stoß auf alle freien Knoten (Scrollen): Geschwindigkeit dazu. */
export function applyImpulse(sim, vx, vy) {
  sim.nodes.forEach((node) => {
    if (node.pinned) return;
    node.px -= vx;
    node.py -= vy;
  });
}

/** Ein Physikschritt: Kräfte (Schwerkraft, Wind, Zeiger), dann die Fäden dreimal auf Ruhelänge ziehen. */
export function stepPhysics(sim, dt) {
  const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.02)));
  const h = dt / steps;
  for (let s = 0; s < steps; s += 1) {
    sim.nodes.forEach((node) => {
      if (node.pinned) return;
      const vx = (node.x - node.px) * DAMPING;
      const vy = (node.y - node.py) * DAMPING;
      node.px = node.x;
      node.py = node.y;
      let ax = sim.wind.x;
      let ay = GRAVITY + sim.wind.y;
      node.x += vx + ax * h * h;
      node.y += vy + ay * h * h;
      if (sim.pointer) {
        const dx = node.x - sim.pointer.x;
        const dy = node.y - sim.pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < POINTER_RADIUS && d > 0.01) {
          // Der Zeiger schiebt Knoten direkt beiseite - wie ein Finger im Netz; die Fäden ziehen sie zurück.
          const push = (POINTER_PUSH * (1 - d / POINTER_RADIUS)) / d;
          node.x += dx * push;
          node.y += dy * push;
        }
      }
    });
    for (let iteration = 0; iteration < 3; iteration += 1) {
      sim.threads.forEach((thread) => {
        if (thread.built < 1) return;
        const a = sim.nodes[thread.a];
        const b = sim.nodes[thread.b];
        if (a.pinned && b.pinned) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const diff = ((dist - thread.rest) / dist) * STIFFNESS[thread.kind];
        const share = a.pinned || b.pinned ? 1 : 0.5;
        if (!a.pinned) {
          a.x += dx * diff * share;
          a.y += dy * diff * share;
        }
        if (!b.pinned) {
          b.x -= dx * diff * share;
          b.y -= dy * diff * share;
        }
      });
    }
  }
}

/** Die Spinne auf dem Canvas: Körper aus zwei Teilen, acht Beine mit Kniegelenk, Augen im Türkis der Saison. */
export function drawSpider(ctx, spider, scale = 1.1) {
  ctx.save();
  ctx.translate(spider.x, spider.y);
  ctx.rotate(spider.heading);
  ctx.scale(scale, scale);
  ctx.strokeStyle = "#1a1520";
  ctx.fillStyle = "#1a1520";
  ctx.lineWidth = 1;
  ctx.lineCap = "round";
  const tilt = [-0.7, -0.25, 0.25, 0.75];
  [-1, 1].forEach((side) => {
    tilt.forEach((angle, j) => {
      const swing = spider.moving ? Math.sin(spider.phase + j * 1.6) * 0.22 * side : Math.sin(spider.phase * 0.5 + j) * 0.03;
      const a = side * (Math.PI / 2 + angle) + swing;
      const baseX = 1.2 - j * 0.9;
      const kneeX = baseX + Math.cos(a) * 4;
      const kneeY = Math.sin(a) * 4;
      const tipX = kneeX + Math.cos(a + side * 0.9) * 3.6;
      const tipY = kneeY + Math.sin(a + side * 0.9) * 3.6;
      ctx.beginPath();
      ctx.moveTo(baseX, 0);
      ctx.lineTo(kneeX, kneeY);
      ctx.lineTo(tipX, tipY);
      ctx.stroke();
    });
  });
  ctx.beginPath();
  ctx.ellipse(-2.7, 0, 3.6, 2.6, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(1.6, 0, 2.1, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#9be7ff";
  ctx.beginPath();
  ctx.arc(3.1, -0.8, 0.45, 0, Math.PI * 2);
  ctx.arc(3.1, 0.8, 0.45, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** Zeichnet die gebauten Fäden (den laufenden nur bis zur Spinne), Tautropfen und die Spinne. */
export function drawSim(ctx, sim, { showSpider = true } = {}) {
  const passes = [
    { kinds: ["anchor", "frame", "radius", "hubring"], style: THREAD_MAIN, width: 0.9 },
    { kinds: ["spiral"], style: THREAD_FINE, width: 0.65 },
  ];
  ctx.save();
  ctx.lineCap = "round";
  // Ein weicher Schein nur unter Ankern und Rahmen - wenige Linien, kein Filter.
  ctx.strokeStyle = THREAD_GLOW;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  sim.threads.forEach((thread) => {
    if (thread.built < 1 || (thread.kind !== "anchor" && thread.kind !== "frame")) return;
    ctx.moveTo(sim.nodes[thread.a].x, sim.nodes[thread.a].y);
    ctx.lineTo(sim.nodes[thread.b].x, sim.nodes[thread.b].y);
  });
  ctx.stroke();
  passes.forEach((pass) => {
    ctx.strokeStyle = pass.style;
    ctx.lineWidth = pass.width;
    ctx.beginPath();
    sim.threads.forEach((thread) => {
      if (thread.built <= 0 || !pass.kinds.includes(thread.kind)) return;
      const a = sim.nodes[thread.a];
      const b = sim.nodes[thread.b];
      ctx.moveTo(a.x, a.y);
      if (thread.built >= 1) ctx.lineTo(b.x, b.y);
      else ctx.lineTo(a.x + (b.x - a.x) * thread.built, a.y + (b.y - a.y) * thread.built);
    });
    ctx.stroke();
  });
  sim.plan.dew.forEach((id) => {
    const node = sim.nodes[id];
    if (node.links < 2) return;
    ctx.fillStyle = "rgba(170, 225, 240, 0.16)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, 3.4, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = "rgba(225, 246, 255, 0.85)";
    ctx.beginPath();
    ctx.arc(node.x, node.y, 1.4, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
  if (showSpider) drawSpider(ctx, sim.spider);
}

/** Sanfter Wind: Grundstärke mal einem langsamen Auf und Ab, damit das Netz nie ganz still hängt. */
export function windAt(seconds, base = 0.6) {
  return { x: base * (120 + 100 * Math.sin(seconds / 3.7) + 60 * Math.sin(seconds / 1.3 + 1)), y: base * 40 * Math.sin(seconds / 2.9) };
}

/**
 * Die Ebene für den gemeinsamen Loop: baut die Simulation für die Fenstergröße, hört auf Zeiger und Scrollen
 * (nur solange sie lebt) und zeichnet. `win` ist nur für Tests austauschbar.
 */
export function createWebLayer({ seed, corner = "tl", factor = 1, build = true, windBase = 0.6, rng = Math.random }, win = typeof window === "undefined" ? null : window) {
  const plan = buildPlan(seed);
  const mirror = corner === "tr";
  let sim = null;
  let size = null;
  let lastScroll = win ? win.scrollY : 0;
  const pointer = { x: -9999, y: -9999, seen: 0 };
  const onMove = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.seen = 6;
  };
  const onScroll = () => {
    const now = win.scrollY;
    const delta = Math.max(-30, Math.min(30, now - lastScroll));
    lastScroll = now;
    if (sim) applyImpulse(sim, 0, -delta * 0.35);
  };
  if (win) {
    win.addEventListener("mousemove", onMove, { passive: true });
    win.addEventListener("scroll", onScroll, { passive: true });
  }
  const ensure = (viewport) => {
    const radius = webRadius(viewport.width, factor);
    const origin = { x: mirror ? viewport.width : 0, y: 0 };
    if (!sim) sim = createSim(plan, { radius, origin, mirror, prebuilt: !build });
    else if (size.width !== viewport.width || size.height !== viewport.height) resizeSim(sim, { radius, origin });
    size = { ...viewport };
    return sim;
  };
  let seconds = 0;
  return {
    key: `halloween-web-${corner}`,
    get sim() {
      return sim;
    },
    draw(ctx, dt, viewport) {
      const current = ensure(viewport);
      seconds += dt;
      current.wind = windAt(seconds, windBase);
      current.pointer = pointer.seen > 0 ? { x: pointer.x, y: pointer.y } : null;
      if (pointer.seen > 0) pointer.seen -= 1;
      if (!current.done) advanceBuild(current, dt);
      else advanceIdle(current, dt, rng);
      stepPhysics(current, dt);
      drawSim(ctx, current);
    },
    dispose() {
      if (!win) return;
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("scroll", onScroll);
    },
  };
}
