// Rundes Radnetz für die App (#665, nach #660/#670 im Web): derselbe Bauplan wie im Web - Ankerfäden und Rahmen,
// Speichen in Spinnen-Reihenfolge, Nabe, Fangspirale von außen nach innen - nur kleiner (weniger Speichen und
// Windungen, damit der Screen nicht hunderte SVG-Linien zeichnet). Ohne Physik (die kommt mit Skia, #667);
// das Netz hängt ganz im Bild an drei Fäden in einer oberen Ecke.
import { hashString, mulberry32 } from "./rng";

export const RADII_CHOICES = [10, 12, 14];
export const RINGS_CHOICES = [6, 7, 8];
export const SPIN_SPEED = 70;
export const WALK_SPEED = 130;
/** Ausdehnung des ganzen Netzes samt Ankerfäden in Radien, von der Ecke aus. */
export const EXTENT = { x: 2.32, y: 2.42 };
/** Die Nabe sitzt hier, von der Ecke aus gemessen (in Radien). */
export const HUB = { x: 1.25, y: 1.35 };
/** Anker relativ zur Nabe: die Ecke, die obere Kante, die seitliche Kante. */
export const ANCHORS: Array<[number, number]> = [[-1.25, -1.35], [1.07, -1.35], [-1.25, 1.07]];
const HUB_RING = 0.12;
const FIRST_RING = 0.24;
const LAST_RING = 0.9;

export type ThreadKind = "anchor" | "frame" | "radius" | "hubring" | "spiral";
export type PlanNode = { x: number; y: number; kind: string; i?: number; k?: number; pinned?: boolean };
export type Thread = { kind: ThreadKind; a: number; b: number; rest: number };
export type Step = { thread?: number; walk?: boolean; from: number; to: number };
export type WebPlan = { nodes: PlanNode[]; threads: Thread[]; order: Step[]; dew: number[]; seed: number; radii: number; rings: number; turn: 1 | -1 };

export function nodeId(i: number, k: number, rings: number): number {
  return 1 + i * (rings + 1) + k;
}

function ringRadius(k: number, rings: number): number {
  if (k <= 0) return HUB_RING;
  return FIRST_RING + ((k - 1) / (rings - 2)) * (LAST_RING - FIRST_RING);
}

function angleDiff(a: number, b: number): number {
  return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** Die Reihenfolge, in der eine Spinne ihre Speichen legt: immer ungefähr gegenüber der letzten, bis alle da sind. */
export function spiderOrder(radii: number): number[] {
  let step = Math.floor(radii / 2) + 1;
  while (gcd(step, radii) !== 1) step -= 1;
  const order: number[] = [];
  let i = 0;
  for (let n = 0; n < radii; n += 1) {
    order.push(i);
    i = (i + step) % radii;
  }
  return order;
}

/** Radius in Pixel für eine Screenbreite: 44–96 px, mal Faktor. */
export function webRadius(width: number, factor = 1): number {
  return Math.round(Math.max(44, Math.min(96, width * 0.16)) * factor);
}

export function buildPlan(seed = 0.37): WebPlan {
  const rng = mulberry32(hashString(`web:${seed}`));
  const radii = RADII_CHOICES[Math.floor(rng() * RADII_CHOICES.length)];
  const rings = RINGS_CHOICES[Math.floor(rng() * RINGS_CHOICES.length)];
  const turn: 1 | -1 = rng() < 0.5 ? 1 : -1;
  const nodes: PlanNode[] = [{ x: 0, y: 0, kind: "hub" }];
  const angles: number[] = [];
  const frame: number[] = [];
  for (let i = 0; i < radii; i += 1) {
    angles.push(-Math.PI / 2 + turn * (i / radii) * Math.PI * 2 + (rng() - 0.5) * 0.12);
    frame.push(0.95 + rng() * 0.1);
  }
  for (let i = 0; i < radii; i += 1) {
    for (let k = 0; k <= rings; k += 1) {
      let r: number;
      if (k === rings) r = frame[i];
      else if (k === 0) r = HUB_RING;
      else {
        const next = k < rings - 1 ? ringRadius(k + 1, rings) : Math.min(frame[i] - 0.05, LAST_RING + 0.05);
        r = ringRadius(k, rings) + (i / radii) * (next - ringRadius(k, rings));
      }
      nodes.push({ x: Math.cos(angles[i]) * r, y: Math.sin(angles[i]) * r, kind: k === rings ? "frame" : k === 0 ? "hubring" : "spiral", i, k });
    }
  }
  const id = (i: number, k: number) => nodeId(i, k, rings);
  const threads: Thread[] = [];
  const order: Step[] = [];
  const add = (kind: ThreadKind, a: number, b: number) => {
    threads.push({ kind, a, b, rest: Math.hypot(nodes[a].x - nodes[b].x, nodes[a].y - nodes[b].y) });
    return threads.length - 1;
  };
  const spin = (kind: ThreadKind, a: number, b: number) => order.push({ thread: add(kind, a, b), from: a, to: b });
  const walk = (from: number, to: number) => order.push({ walk: true, from, to });

  const anchorAt = ANCHORS.map(([ax, ay]) => {
    const angle = Math.atan2(ay, ax);
    let best = 0;
    for (let i = 1; i < radii; i += 1) if (angleDiff(angles[i], angle) < angleDiff(angles[best], angle)) best = i;
    const mid = nodes.push({ x: (nodes[id(best, rings)].x + ax) / 2, y: (nodes[id(best, rings)].y + ay) / 2, kind: "mid" }) - 1;
    const anchor = nodes.push({ x: ax, y: ay, kind: "anchor", pinned: true }) - 1;
    return { frame: best, mid, anchor };
  });

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
  [second, third].forEach((entry) => {
    if (entry.frame !== first.frame) return;
    spin("anchor", id(at, rings), entry.mid);
    spin("anchor", entry.mid, entry.anchor);
    walk(entry.anchor, entry.mid);
    walk(entry.mid, id(at, rings));
  });

  const firstRadius = first.frame;
  for (let k = rings; k > 0; k -= 1) spin("radius", id(firstRadius, k), id(firstRadius, k - 1));
  spin("radius", id(firstRadius, 0), 0);
  spiderOrder(radii).filter((i) => i !== firstRadius).forEach((i) => {
    spin("radius", 0, id(i, 0));
    for (let k = 0; k < rings; k += 1) spin("radius", id(i, k), id(i, k + 1));
    for (let k = rings; k > 0; k -= 1) walk(id(i, k), id(i, k - 1));
    walk(id(i, 0), 0);
  });

  walk(0, id(0, 0));
  for (let i = 0; i < radii; i += 1) spin("hubring", id(i, 0), id((i + 1) % radii, 0));

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

  const dew: number[] = [];
  const dewRng = mulberry32(hashString(`dew:${seed}`));
  for (let n = 0; n < 5; n += 1) dew.push(id(Math.floor(dewRng() * radii), 2 + Math.floor(dewRng() * (rings - 3))));
  return { nodes, threads, order, dew, seed, radii, rings, turn };
}

export type Point = { x: number; y: number };

/** Knotenposition in Pixel im Kasten EXTENT × Radius, Ecke oben links; `mirror` spiegelt für die rechte Ecke. */
export function toPixels(node: PlanNode, radius: number, mirror = false): Point {
  const x = (HUB.x + node.x) * radius;
  const y = (HUB.y + node.y) * radius;
  return { x: mirror ? EXTENT.x * radius - x : x, y };
}

export type PlanLine = { kind: ThreadKind; x1: number; y1: number; x2: number; y2: number };

export function planLines(plan: WebPlan, radius: number, mirror = false): PlanLine[] {
  return plan.threads.map((thread) => {
    const a = toPixels(plan.nodes[thread.a], radius, mirror);
    const b = toPixels(plan.nodes[thread.b], radius, mirror);
    return { kind: thread.kind, x1: a.x, y1: a.y, x2: b.x, y2: b.y };
  });
}

/** Dauer eines Bauschritts in Millisekunden: Weg durch Tempo (spinnen langsam, laufen schneller). */
export function stepDurationMs(plan: WebPlan, step: Step, radius: number): number {
  const from = plan.nodes[step.from];
  const to = plan.nodes[step.to];
  const length = Math.hypot(to.x - from.x, to.y - from.y) * radius;
  return Math.max(40, Math.round((length / (step.walk ? WALK_SPEED : SPIN_SPEED)) * 1000));
}
