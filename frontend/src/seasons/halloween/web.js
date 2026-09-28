// Rundes Netz mit Physik (#660, Nachbesserung nach #668 live, Runde V): ein Bauplan in der Reihenfolge einer echten
// Radnetzspinne (Ankerfäden und Rahmen, Speichen, Nabe, Fangspirale von außen nach innen), Verlet-Physik für jeden
// Faden (Zeiger stupst an, Scrollen gibt einen Stoß, Wind bewegt), Zeichnen auf dem gemeinsamen Canvas samt Spinne,
// der man beim Spinnen zuschauen kann - und ein statisches SVG für „dezent“ und „Bewegung reduzieren“.
// Während des Baus steht das Netz straff (alle Knoten fest), erst das fertige Netz schwingt; jeder Knoten hat
// eine weiche Rückstellung zur Ruheform, Stöße und Schritte sind begrenzt - so knautscht nichts mehr.
// Neu (Rückmeldung 28.09.): Die Spinne verlässt ihr fertiges Netz zeitweise über den Ankerfaden in die Ecke. Wer
// dann mit gedrückter Maus ins Netz greift und zieht, hat es an der Hand: die Ankerfäden reißen nacheinander, das
// Netz faltet sich zusammen und hängt am Zeiger; losgelassen trägt es der Wind davon. Bleibt die Spinne lange fort,
// reißt auch ein Windstoß die Anker. Danach kommt die Spinne zurück und spinnt ein neues Netz - jedes anders.
// Der Plan rechnet in Nabe-Koordinaten mit Radius 1, erst die Simulation rechnet in Pixel um. Kein Paket.
import { hashString, mulberry32 } from "../rng";

export const RADII = 16;
export const RINGS = 9;
export const RADII_CHOICES = [12, 14, 16, 18];
export const RINGS_CHOICES = [7, 8, 9, 10];
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
const GRAVITY = 6;
const DAMPING = 0.94;
const STIFFNESS = { anchor: 0.9, frame: 0.9, radius: 0.9, hubring: 0.8, spiral: 0.6 };
const ITERATIONS = 5;
/** Höchstens so viele Pixel bewegt sich ein Knoten je Schritt - kein Faden reißt aus, nichts explodiert. */
const MAX_STEP = 4;
/** Weiche Rückstellung zur Ruheform je Schritt: das Netz findet immer zu seiner Gestalt zurück. */
const REST_PULL = 0.03;
/** Weiter als so viel vom Radius entfernt sich kein Knoten von seiner Ruhelage - das Netz bleibt ein Netz. */
const MAX_DRIFT = 0.15;
const IMPULSE_MAX = 1.5;
/** Scroll-Stöße höchstens alle 150 ms - ein Wackler je Scrollbewegung, kein Dauerbeben. */
export const IMPULSE_GAP_MS = 150;
const POINTER_RADIUS = 42;
const POINTER_PUSH = 2.2;

/** Greifen: Knoten so nah am Zeiger kommen mit; erst nach so viel Weg ist es ein Ziehen und kein Klick. */
export const GRAB_RADIUS = 34;
export const GRAB_MIN_MOVE = 6;
/** Die Anker reißen nacheinander, je nach Zugweg in Radien: der fernste zuerst. */
export const TEAR_PULL = [0.35, 0.7, 1.05];
/** Angerissen oder frei: Windungen und Speichen ziehen sich je Schritt zusammen, bis auf einen Teil der Ruhelänge. */
const FOLD_SHRINK = 0.992;
const FOLD_MIN = 0.35;
/** Ein angerissenes Netz hängt schwer und faltet sich unter der Schwerkraft zusammen. */
const FOLD_GRAVITY = 260;
const FOLD_DAMPING = 0.965;
/** Ein freies Netz ist leicht: wenig Schwerkraft, viel Wind, ein Hauch Auftrieb, Geflatter; es verblasst beim Davonfliegen. */
const FLY_GRAVITY = 60;
const FLY_DAMPING = 0.985;
const FLY_STEP = 9;
const FLY_WIND = 3;
const FLY_LIFT = 40;
const FLY_FLUTTER = 0.9;
export const FADE_AFTER = 1.2;
export const FADE_SECONDS = 2.4;
/** Sekunden (von–bis): bis die Spinne das fertige Netz verlässt, wie lange sie fort ist, bis ein Windstoß reißt, bis ein neues Netz beginnt. */
export const LEAVE_AFTER = [50, 110];
export const AWAY_FOR = [40, 120];
export const GUST_AFTER = [90, 300];
export const RESPAWN_AFTER = [15, 40];

function between(rng, [low, high]) {
  return low + rng() * (high - low);
}

export function nodeId(i, k, rings = RINGS) {
  return 1 + i * (rings + 1) + k;
}

function ringRadius(k, rings) {
  if (k <= 0) return HUB_RING;
  return FIRST_RING + ((k - 1) / (rings - 2)) * (LAST_RING - FIRST_RING);
}

function angleDiff(a, b) {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function gcd(a, b) {
  return b === 0 ? a : gcd(b, a % b);
}

/** Die Reihenfolge, in der eine Spinne ihre Speichen legt: immer ungefähr gegenüber der letzten, bis alle da sind. */
export function spiderOrder(radii) {
  let step = Math.floor(radii / 2) + 1;
  while (gcd(step, radii) !== 1) step -= 1;
  const order = [];
  let i = 0;
  for (let n = 0; n < radii; n += 1) {
    order.push(i);
    i = (i + step) % radii;
  }
  return order;
}

/** Radius in Pixel für eine Fensterbreite: 56–150 px, mal Seitenfaktor. */
export function webRadius(width, factor = 1) {
  return Math.round(Math.max(56, Math.min(150, width * 0.085)) * factor);
}

/**
 * Bauplan: Knoten (Einheitsradius, Nabe im Ursprung), Fäden mit Art und Ruhelänge, Reihenfolge des Baus als
 * Schritte { thread, from, to } (Faden spinnen) oder { walk: true, from, to } (nur laufen). Speichen, Windungen
 * und Drehsinn kommen aus dem Seed - kein Netz gleicht dem anderen. `exits` sind die Ankerwege (Rahmenknoten,
 * Zwischenknoten, Anker), über die die Spinne das Netz verlässt.
 */
export function buildPlan(seed = 0.37) {
  const rng = mulberry32(hashString(`web:${seed}`));
  const radii = RADII_CHOICES[Math.floor(rng() * RADII_CHOICES.length)];
  const rings = RINGS_CHOICES[Math.floor(rng() * RINGS_CHOICES.length)];
  const turn = rng() < 0.5 ? 1 : -1;
  const nodes = [{ x: 0, y: 0, kind: "hub" }];
  const angles = [];
  const frame = [];
  for (let i = 0; i < radii; i += 1) {
    angles.push(-Math.PI / 2 + turn * (i / radii) * Math.PI * 2 + (rng() - 0.5) * 0.12);
    frame.push(0.95 + rng() * 0.1);
  }
  for (let i = 0; i < radii; i += 1) {
    for (let k = 0; k <= rings; k += 1) {
      let r;
      if (k === rings) r = frame[i];
      else if (k === 0) r = HUB_RING;
      else {
        const next = k < rings - 1 ? ringRadius(k + 1, rings) : Math.min(frame[i] - 0.05, LAST_RING + 0.05);
        r = ringRadius(k, rings) + (i / radii) * (next - ringRadius(k, rings));
      }
      nodes.push({ x: Math.cos(angles[i]) * r, y: Math.sin(angles[i]) * r, kind: k === rings ? "frame" : k === 0 ? "hubring" : "spiral", i, k });
    }
  }
  const id = (i, k) => nodeId(i, k, rings);
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
    for (let i = 1; i < radii; i += 1) if (angleDiff(angles[i], angle) < angleDiff(angles[best], angle)) best = i;
    const mid = nodes.push({ x: (nodes[id(best, rings)].x + ax) / 2, y: (nodes[id(best, rings)].y + ay) / 2, kind: "mid" }) - 1;
    const anchor = nodes.push({ x: ax, y: ay, kind: "anchor", pinned: true }) - 1;
    return { frame: best, mid, anchor };
  });

  // 1. Von der Ecke aus der erste Ankerfaden, dann der Rahmen einmal herum - an den anderen beiden Ankern
  //    geht ein Faden zur Kante und die Spinne kommt zurück.
  const [first, second, third] = anchorAt;
  spin("anchor", first.anchor, first.mid);
  spin("anchor", first.mid, id(first.frame, rings));
  let at = first.frame;
  for (let n = 1; n <= radii; n += 1) {
    const next = (first.frame + n) % radii;
    spin("frame", id(at, rings), id(next, rings));
    at = next;
    [second, third].forEach((entry) => {
      if (entry.frame !== at || entry.frame === first.frame) return;
      spin("anchor", id(at, rings), entry.mid);
      spin("anchor", entry.mid, entry.anchor);
      walk(entry.anchor, entry.mid);
      walk(entry.mid, id(at, rings));
    });
  }
  // Fällt ein Anker auf denselben Rahmenknoten wie der erste (bei wenigen Speichen möglich), kommt er zum Schluss.
  [second, third].forEach((entry) => {
    if (entry.frame !== first.frame) return;
    spin("anchor", id(at, rings), entry.mid);
    spin("anchor", entry.mid, entry.anchor);
    walk(entry.anchor, entry.mid);
    walk(entry.mid, id(at, rings));
  });

  // 2. Speichen: die erste vom Rahmen zur Nabe, alle weiteren von der Nabe nach außen und zurück.
  const firstRadius = first.frame;
  for (let k = rings; k > 0; k -= 1) spin("radius", id(firstRadius, k), id(firstRadius, k - 1));
  spin("radius", id(firstRadius, 0), 0);
  spiderOrder(radii).filter((i) => i !== firstRadius).forEach((i) => {
    spin("radius", 0, id(i, 0));
    for (let k = 0; k < rings; k += 1) spin("radius", id(i, k), id(i, k + 1));
    for (let k = rings; k > 0; k -= 1) walk(id(i, k), id(i, k - 1));
    walk(id(i, 0), 0);
  });

  // 3. Die Nabe: ein kleiner Ring um die Mitte.
  walk(0, id(0, 0));
  for (let i = 0; i < radii; i += 1) spin("hubring", id(i, 0), id((i + 1) % radii, 0));

  // 4. Fangspirale von außen nach innen: erst hinauslaufen, dann Windung für Windung zur Nabe.
  const outer = rings - 1;
  walk(id(0, 0), id(radii - 1, 0));
  for (let k = 0; k < outer; k += 1) walk(id(radii - 1, k), id(radii - 1, k + 1));
  for (let k = outer; k >= 1; k -= 1) {
    for (let i = radii - 1; i >= 0; i -= 1) {
      if (i === radii - 1) {
        if (k === outer) continue;
        spin("spiral", id(0, k + 1), id(radii - 1, k));
      } else {
        spin("spiral", id(i + 1, k), id(i, k));
      }
    }
  }
  walk(id(0, 1), id(0, 0));
  walk(id(0, 0), 0);

  const dew = [];
  const dewRng = mulberry32(hashString(`dew:${seed}`));
  for (let n = 0; n < 7; n += 1) dew.push(id(Math.floor(dewRng() * radii), 2 + Math.floor(dewRng() * (rings - 3))));
  const exits = anchorAt.map((entry) => ({ frame: entry.frame, mid: entry.mid, anchor: entry.anchor }));
  return { nodes, threads, order, dew, exits, seed, radii, rings, turn };
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

/**
 * Die Simulation in Pixel: Knoten mit Vorposition und Ruheform (Verlet), Fäden mit Ruhelänge und Baufortschritt;
 * dazu der Zustand des Netzes: gerissene Anker (`torn`), frei (`free`), an der Hand (`grab`), Deckkraft, weg (`gone`),
 * und die Uhren der Spinne (`leaveIn`, `awayFor`, `gustIn`).
 */
export function createSim(plan, { radius, origin, mirror = false, prebuilt = false }) {
  const nodes = plan.nodes.map((node) => {
    const p = toPixels(node, radius, mirror, origin);
    return { x: p.x, y: p.y, px: p.x, py: p.y, rx: p.x, ry: p.y, anchor: Boolean(node.pinned), pinned: true, held: false, links: 0 };
  });
  const threads = plan.threads.map((thread) => ({ ...thread, rest: thread.rest * radius, rest0: thread.rest * radius, built: 0 }));
  const sim = {
    plan, nodes, threads, radius, origin, mirror, step: 0, t: 0, done: false, pointer: null, wind: { x: 0, y: 0 }, impulse: { x: 0, y: 0 },
    spider: { x: nodes[0].x, y: nodes[0].y, heading: 0, phase: 0, moving: false, away: false }, idle: 45, patrol: null,
    torn: 0, free: false, grab: null, alpha: 1, flying: 0, gone: false, leaveIn: null, awayFor: 0, gustIn: null,
  };
  if (prebuilt) {
    threads.forEach((thread) => finishThread(sim, thread));
    sim.step = plan.order.length;
    sim.done = true;
    releaseNodes(sim);
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
  sim.nodes[thread.a].links += 1;
  sim.nodes[thread.b].links += 1;
}

/** Das fertige Netz darf schwingen: alle Knoten außer den Ankern werden frei. */
function releaseNodes(sim) {
  sim.nodes.forEach((node) => {
    if (!node.anchor) node.pinned = false;
  });
}

/** Neue Größe: alle Ruhepositionen neu, Baufortschritt bleibt. */
export function resizeSim(sim, { radius, origin }) {
  sim.radius = radius;
  sim.origin = origin;
  sim.plan.nodes.forEach((node, index) => {
    const p = toPixels(node, radius, sim.mirror, origin);
    Object.assign(sim.nodes[index], { x: p.x, y: p.y, px: p.x, py: p.y, rx: p.x, ry: p.y });
  });
  sim.threads.forEach((thread, index) => {
    thread.rest = sim.plan.threads[index].rest * radius;
    thread.rest0 = thread.rest;
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
    // Erst finishThread setzt 1 und zählt die Verbindungen.
    if (!item.walk) sim.threads[item.thread].built = Math.min(0.999, sim.t);
    if (sim.t >= 1 - 1e-6) {
      if (!item.walk) finishThread(sim, sim.threads[item.thread]);
      sim.step += 1;
      sim.t = 0;
      if (sim.step >= sim.plan.order.length) {
        sim.done = true;
        sim.spider.moving = false;
        releaseNodes(sim);
      }
    }
  }
}

/** Der Weg aus dem Netz: Nabe, die Speiche zum ersten Anker hinaus, Zwischenknoten, Anker (die Ecke). */
export function exitPath(sim) {
  const exit = sim.plan.exits[0];
  const { rings } = sim.plan;
  const path = [0];
  for (let k = 0; k <= rings; k += 1) path.push(nodeId(exit.frame, k, rings));
  path.push(exit.mid, exit.anchor);
  return path;
}

/** Die Spinne verlässt das Netz über den Ankerfaden; `hurry`, wenn jemand ins Netz greift. */
export function sendSpiderAway(sim, rng = Math.random, hurry = false) {
  if (sim.spider.away || (sim.patrol && sim.patrol.leaving)) return;
  sim.patrol = { path: exitPath(sim), index: 0, t: 0, leaving: true, speed: hurry ? 3 : 1.2 };
  sim.leaveIn = between(rng, LEAVE_AFTER);
}

/**
 * Fertiges Netz: die Spinne sitzt in der Nabe, atmet, geht alle 40–90 s einmal eine Speiche hinaus und zurück und
 * verlässt das Netz nach 50–110 s über den Ankerfaden in die Ecke; nach 40–120 s kommt sie zurück - sofern das Netz
 * noch ganz ist. Bleibt sie länger fort als ein Windstoß braucht, reißen die Anker nacheinander; ein angerissenes
 * Netz reißt nach kurzer Zeit ganz.
 */
export function advanceIdle(sim, dt, rng = Math.random) {
  const spider = sim.spider;
  const { radii, rings } = sim.plan;
  if (sim.torn > 0 && !sim.free && !sim.grab) {
    if (sim.gustIn === null) sim.gustIn = 6 + rng() * 12;
    sim.gustIn -= dt;
    if (sim.gustIn <= 0) {
      tearAnchor(sim);
      sim.gustIn = 2 + rng() * 3;
    }
  }
  if (!sim.patrol) {
    if (spider.away) {
      sim.awayFor -= dt;
      if (sim.torn === 0 && !sim.grab) {
        sim.gustIn -= dt;
        if (sim.gustIn <= 0) {
          tearAnchor(sim);
          sim.gustIn = 2 + rng() * 3;
        } else if (sim.awayFor <= 0) {
          sim.patrol = { path: exitPath(sim).reverse(), index: 0, t: 0, returning: true, speed: 1.2 };
        }
      }
      if (!sim.patrol) return;
    } else {
      if (sim.leaveIn === null) sim.leaveIn = between(rng, LEAVE_AFTER);
      sim.idle -= dt;
      sim.leaveIn -= dt;
      spider.phase += dt * 1.5;
      if (sim.leaveIn <= 0) {
        sendSpiderAway(sim, rng);
      } else {
        if (sim.idle > 0) return;
        const radius = Math.floor(rng() * radii);
        const path = [];
        for (let k = 0; k <= rings; k += 1) path.push(nodeId(radius, k, rings));
        sim.patrol = { path: [0, ...path, ...path.slice().reverse(), 0], index: 0, t: 0, speed: 1 };
        sim.idle = 40 + rng() * 50;
      }
    }
  }
  const patrol = sim.patrol;
  const from = sim.nodes[patrol.path[patrol.index]];
  const to = sim.nodes[patrol.path[patrol.index + 1]];
  const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
  patrol.t += (dt * WALK_SPEED * 0.55 * (patrol.speed || 1)) / length;
  spider.moving = true;
  spider.phase += dt * 16 * (patrol.speed || 1);
  spider.heading = Math.atan2(to.y - from.y, to.x - from.x);
  spider.x = from.x + (to.x - from.x) * Math.min(1, patrol.t);
  spider.y = from.y + (to.y - from.y) * Math.min(1, patrol.t);
  if (patrol.t >= 1) {
    patrol.index += 1;
    patrol.t = 0;
    if (patrol.index >= patrol.path.length - 1) {
      sim.patrol = null;
      spider.moving = false;
      if (patrol.leaving) {
        spider.away = true;
        sim.awayFor = between(rng, AWAY_FOR);
        sim.gustIn = between(rng, GUST_AFTER);
      } else if (patrol.returning) {
        spider.away = false;
        sim.leaveIn = between(rng, LEAVE_AFTER);
        sim.idle = 20 + rng() * 30;
      }
    }
  }
}

/** Stoß auf alle freien Knoten (Scrollen): wird gesammelt und im nächsten Schritt begrenzt angewendet. */
export function applyImpulse(sim, vx, vy) {
  sim.impulse.x += vx;
  sim.impulse.y += vy;
}

function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

/** Ein Anker reißt: sein Knoten wird frei und der Faden hängt lose am Netz. Ohne Anker ist das Netz frei. */
export function tearAnchor(sim, index = null) {
  const pinned = sim.nodes.map((node, i) => ({ node, i })).filter((entry) => entry.node.anchor && entry.node.pinned);
  if (!pinned.length) return false;
  const pick = pinned.find((entry) => entry.i === index) || pinned[0];
  pick.node.pinned = false;
  sim.torn += 1;
  sim.free = pinned.length === 1;
  return true;
}

/** Knoten nahe dem Zeiger (keine Anker, nur verbundene): die Hand greift ins Netz. */
export function grabNodes(sim, x, y, radius = GRAB_RADIUS) {
  return sim.nodes
    .map((node, index) => ({ index, node, d: Math.hypot(node.x - x, node.y - y) }))
    .filter((entry) => entry.d < radius && !entry.node.anchor && entry.node.links > 0)
    .sort((a, b) => a.d - b.d)
    .slice(0, 5)
    .map((entry) => ({ index: entry.index, dx: entry.node.x - x, dy: entry.node.y - y }));
}

export function startGrab(sim, x, y, nodes) {
  sim.grab = { x, y, x0: x, y0: y, nodes };
  nodes.forEach((entry) => {
    sim.nodes[entry.index].held = true;
  });
}

export function moveGrab(sim, x, y) {
  if (!sim.grab) return;
  sim.grab.x = x;
  sim.grab.y = y;
}

/** Losgelassen: ein freies Netz fliegt davon, ein angerissenes hängt noch kurz und reißt dann von selbst. */
export function releaseGrab(sim, rng = Math.random) {
  if (!sim.grab) return;
  sim.grab.nodes.forEach((entry) => {
    sim.nodes[entry.index].held = false;
  });
  sim.grab = null;
  if (sim.torn > 0 && !sim.free) sim.gustIn = 6 + rng() * 12;
}

/** Beim Ziehen reißen die Anker mit dem Zugweg, der fernste zuerst. */
function tearByPull(sim) {
  const pull = Math.hypot(sim.grab.x - sim.grab.x0, sim.grab.y - sim.grab.y0) / sim.radius;
  while (sim.torn < TEAR_PULL.length && pull > TEAR_PULL[sim.torn]) {
    const pinned = sim.nodes.map((node, i) => ({ node, i })).filter((entry) => entry.node.anchor && entry.node.pinned);
    if (!pinned.length) break;
    pinned.sort((a, b) => Math.hypot(b.node.x - sim.grab.x, b.node.y - sim.grab.y) - Math.hypot(a.node.x - sim.grab.x, a.node.y - sim.grab.y));
    tearAnchor(sim, pinned[0].i);
  }
}

/**
 * Ein Physikschritt: Stoß, Kräfte (Schwerkraft, Wind, Zeiger), weiche Rückstellung, dann die Fäden auf Ruhelänge
 * ziehen. An der Hand oder angerissen fällt die Rückstellung weg - das Netz verformt sich, faltet sich und hängt;
 * frei fliegt es mit dem Wind und verblasst, bis es weg ist.
 */
export function stepPhysics(sim, dt, rng = Math.random) {
  if (sim.gone) return;
  const ix = clamp(sim.impulse.x, IMPULSE_MAX);
  const iy = clamp(sim.impulse.y, IMPULSE_MAX);
  sim.impulse.x = 0;
  sim.impulse.y = 0;
  if (ix || iy) {
    sim.nodes.forEach((node) => {
      if (node.pinned || node.held) return;
      node.px -= ix;
      node.py -= iy;
    });
  }
  const loose = sim.torn > 0 || Boolean(sim.grab);
  const flying = sim.free && !sim.grab;
  if (flying) {
    sim.flying += dt;
    sim.alpha = Math.max(0, 1 - Math.max(0, sim.flying - FADE_AFTER) / FADE_SECONDS);
    if (sim.alpha <= 0) {
      sim.gone = true;
      return;
    }
  }
  const damping = flying ? FLY_DAMPING : loose ? FOLD_DAMPING : DAMPING;
  const maxStep = flying ? FLY_STEP : sim.grab ? 6 : MAX_STEP;
  const gravity = flying ? FLY_GRAVITY : loose ? FOLD_GRAVITY : GRAVITY;
  const windX = flying ? sim.wind.x * FLY_WIND : sim.wind.x;
  const lift = flying ? -(Math.abs(sim.wind.x) * 0.5 + FLY_LIFT) : 0;
  const steps = Math.min(4, Math.max(1, Math.ceil(dt / 0.02)));
  const h = dt / steps;
  for (let s = 0; s < steps; s += 1) {
    if (sim.grab) {
      sim.grab.nodes.forEach((entry) => {
        const node = sim.nodes[entry.index];
        node.x = sim.grab.x + entry.dx;
        node.y = sim.grab.y + entry.dy;
        node.px = node.x;
        node.py = node.y;
      });
    }
    sim.nodes.forEach((node) => {
      if (node.pinned || node.held) return;
      const vx = (node.x - node.px) * damping;
      const vy = (node.y - node.py) * damping;
      node.px = node.x;
      node.py = node.y;
      const flutterX = flying ? (rng() - 0.5) * FLY_FLUTTER : 0;
      const flutterY = flying ? (rng() - 0.5) * FLY_FLUTTER : 0;
      node.x += clamp(vx + windX * h * h + flutterX, maxStep);
      node.y += clamp(vy + (gravity + sim.wind.y + lift) * h * h + flutterY, maxStep);
      if (!loose) {
        node.x += (node.rx - node.x) * REST_PULL;
        node.y += (node.ry - node.y) * REST_PULL;
        const driftX = node.x - node.rx;
        const driftY = node.y - node.ry;
        const drift = Math.hypot(driftX, driftY);
        const maxDrift = MAX_DRIFT * sim.radius;
        if (drift > maxDrift) {
          node.x = node.rx + (driftX / drift) * maxDrift;
          node.y = node.ry + (driftY / drift) * maxDrift;
        }
      }
      if (sim.pointer && !sim.grab) {
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
    if (loose) {
      sim.threads.forEach((thread) => {
        if (thread.kind === "anchor" || thread.kind === "frame") return;
        thread.rest = Math.max(thread.rest0 * FOLD_MIN, thread.rest * FOLD_SHRINK);
      });
    }
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      sim.threads.forEach((thread) => {
        if (thread.built < 1) return;
        const a = sim.nodes[thread.a];
        const b = sim.nodes[thread.b];
        const fixedA = a.pinned || a.held;
        const fixedB = b.pinned || b.held;
        if (fixedA && fixedB) return;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.hypot(dx, dy) || 0.001;
        const diff = ((dist - thread.rest) / dist) * STIFFNESS[thread.kind];
        const share = fixedA || fixedB ? 1 : 0.5;
        if (!fixedA) {
          a.x += dx * diff * share;
          a.y += dy * diff * share;
        }
        if (!fixedB) {
          b.x -= dx * diff * share;
          b.y -= dy * diff * share;
        }
      });
    }
  }
  if (sim.grab && !sim.free) tearByPull(sim);
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

/** Zeichnet die gebauten Fäden (den laufenden nur bis zur Spinne), Tautropfen und die Spinne - mit der Deckkraft des Netzes. */
export function drawSim(ctx, sim, { showSpider = true } = {}) {
  if (sim.gone) return;
  const passes = [
    { kinds: ["anchor", "frame", "radius", "hubring"], style: THREAD_MAIN, width: 0.9 },
    { kinds: ["spiral"], style: THREAD_FINE, width: 0.65 },
  ];
  ctx.save();
  if (sim.alpha < 1) ctx.globalAlpha = sim.alpha;
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
  if (showSpider && !sim.spider.away) drawSpider(ctx, sim.spider);
  ctx.restore();
}

/** Sanfter Wind: Grundstärke mal einem langsamen Auf und Ab, damit das Netz nie ganz still hängt. */
export function windAt(seconds, base = 0.6) {
  return { x: base * (120 + 100 * Math.sin(seconds / 3.7) + 60 * Math.sin(seconds / 1.3 + 1)), y: base * 40 * Math.sin(seconds / 2.9) };
}

/**
 * Die Ebene für den gemeinsamen Loop: baut die Simulation für die Fenstergröße, hört auf Zeiger, Maustaste und
 * Scrollen (nur solange sie lebt) und zeichnet. Ist ein Netz davongeflogen, beginnt nach einer Pause ein neues
 * (anderer Plan, immer mit Bau). `win` ist nur für Tests austauschbar.
 */
export function createWebLayer({ seed, corner = "tl", factor = 1, build = true, windBase = 0.6, rng = Math.random, weather = null }, win = typeof window === "undefined" ? null : window) {
  let plan = buildPlan(seed);
  let cycle = 0;
  const mirror = corner === "tr";
  let sim = null;
  let size = null;
  let respawn = 0;
  let lastScroll = win ? win.scrollY : 0;
  const pointer = { x: -9999, y: -9999, seen: 0 };
  // Greifen: Maustaste unten nahe am Netz merkt sich die Knoten; erst Bewegung macht daraus ein Ziehen (ein Klick
  // auf etwas unter dem Netz bleibt ein Klick). Sitzt die Spinne noch im Netz, flieht sie.
  let pending = null;
  // Solange die Hand das Netz hält: kein Textmarkieren in der Seite, der Zeiger zeigt „greifen“ (Klasse am Dokument).
  const setGrabbing = (on) => {
    const root = win && win.document && win.document.documentElement;
    if (!root || !root.classList) return;
    root.classList.toggle("tls-web-grabbing", on);
    if (on && typeof win.getSelection === "function") {
      try {
        win.getSelection().removeAllRanges();
      } catch {
        // ohne Auswahl nichts zu löschen
      }
    }
  };
  const onMove = (event) => {
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    pointer.seen = 6;
    if (sim && pending && !sim.grab && Math.hypot(event.clientX - pending.x, event.clientY - pending.y) > GRAB_MIN_MOVE) {
      if (!sim.spider.away) sendSpiderAway(sim, rng, true);
      startGrab(sim, pending.x, pending.y, pending.nodes);
      setGrabbing(true);
    }
    if (sim && sim.grab) moveGrab(sim, event.clientX, event.clientY);
  };
  const onDown = (event) => {
    if ((event.button || 0) !== 0 || !sim || !sim.done || sim.free || sim.grab) return;
    const nodes = grabNodes(sim, event.clientX, event.clientY);
    if (!nodes.length) return;
    pending = { x: event.clientX, y: event.clientY, nodes };
    // Die Taste gilt dem Netz: kein Markieren beim Ziehen - ein Klick auf etwas darunter bleibt ein Klick.
    if (typeof event.preventDefault === "function") event.preventDefault();
  };
  const onUp = () => {
    pending = null;
    if (sim && sim.grab) {
      releaseGrab(sim, rng);
      setGrabbing(false);
    }
  };
  // Scrollen: ein kleiner Stoß je Scrollbewegung (höchstens alle 150 ms), im Schritt begrenzt - kein Knäuel bei schnellem Rad.
  let lastImpulseAt = -Infinity;
  const onScroll = () => {
    const now = win.scrollY;
    const delta = Math.max(-30, Math.min(30, now - lastScroll));
    lastScroll = now;
    const stamp = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (!sim || stamp - lastImpulseAt < IMPULSE_GAP_MS) return;
    lastImpulseAt = stamp;
    applyImpulse(sim, 0, -delta * 0.05);
  };
  // Echtes Wetter (#666): Windstärke als Faktor (0,3–1,6 gegenüber der Vorgabe 0,6), Richtung als Vorzeichen.
  let windScale = 1;
  let windSign = 1;
  const applyWeather = (conditions) => {
    if (!conditions) return;
    const factor = Number(conditions.wind_factor);
    windScale = factor > 0 ? factor / 0.6 : 1;
    windSign = Number(conditions.wind_dir) > 180 ? 1 : -1;
  };
  applyWeather(weather);
  const onWeather = (event) => applyWeather(event?.detail);
  if (win) {
    win.addEventListener("mousemove", onMove, { passive: true });
    win.addEventListener("mousedown", onDown);
    win.addEventListener("mouseup", onUp, { passive: true });
    win.addEventListener("scroll", onScroll, { passive: true });
    win.addEventListener("tls:season-weather", onWeather);
  }
  const ensure = (viewport) => {
    const radius = webRadius(viewport.width, factor);
    const origin = { x: mirror ? viewport.width : 0, y: 0 };
    if (!sim) sim = createSim(plan, { radius, origin, mirror, prebuilt: !build && cycle === 0 });
    else if (size.width !== viewport.width || size.height !== viewport.height) {
      // Ein loses oder gehaltenes Netz lässt sich nicht neu ausmessen - es ist dann eben weg.
      if (sim.torn > 0 || sim.grab) sim.gone = true;
      else resizeSim(sim, { radius, origin });
    }
    size = { ...viewport };
    return sim;
  };
  let seconds = 0;
  return {
    key: `halloween-web-${corner}`,
    get sim() {
      return sim;
    },
    get wind() {
      return { scale: windScale, sign: windSign };
    },
    get cycle() {
      return cycle;
    },
    draw(ctx, dt, viewport) {
      seconds += dt;
      if (!sim && respawn > 0) {
        respawn -= dt;
        if (respawn > 0) return;
      }
      const current = ensure(viewport);
      const gust = windAt(seconds, windBase * windScale);
      current.wind = { x: gust.x * windSign, y: gust.y };
      current.pointer = pointer.seen > 0 ? { x: pointer.x, y: pointer.y } : null;
      if (pointer.seen > 0) pointer.seen -= 1;
      if (!current.done) advanceBuild(current, dt);
      else advanceIdle(current, dt, rng);
      stepPhysics(current, dt, rng);
      if (current.gone) {
        sim = null;
        pending = null;
        cycle += 1;
        plan = buildPlan((seed + cycle * 0.1373) % 1);
        respawn = between(rng, RESPAWN_AFTER);
        return;
      }
      drawSim(ctx, current);
    },
    dispose() {
      if (!win) return;
      if (sim && sim.grab) setGrabbing(false);
      win.removeEventListener("mousemove", onMove);
      win.removeEventListener("mousedown", onDown);
      win.removeEventListener("mouseup", onUp);
      win.removeEventListener("scroll", onScroll);
      win.removeEventListener("tls:season-weather", onWeather);
    },
  };
}
