// Luftschlangen an Karten (Jahreszeiten IV, #1093) - dieselbe Rechnung wie im Web
// (frontend/src/seasons/carnival/cardStreamer.js, Paritätstest auf beiden Seiten): Auf der Oberkante einiger Karten
// liegt eine gekringelte Luftschlange, ihr Ende hängt an einer Ecke außen über die Kante. Wird die Karte angetippt,
// flattert sie einmal durch: eine Welle hebt die Schlaufen nacheinander an, das Ende pendelt nach außen und federt an
// der Karte zurück; danach liegt sie wieder genau wie vorher. Reine Rechnung; die Anzeige liegt in streamerOnCard.tsx.

import { hashString, mulberry32 } from "../rng";

export const CARD_STREAMER = {
  /** So lang liegt sie auf der Kante, so viele Schlaufen, so hoch sind sie. */
  lying: [54, 104] as [number, number],
  loops: [2, 4] as [number, number],
  height: [5, 7.5] as [number, number],
  /** So weit hängt das Ende über die Ecke herab, so weit steht es außen von der Karte ab. */
  hang: [16, 32] as [number, number],
  out: 4,
  /** So breit ist das Band. */
  stroke: 2.6,
  /** Flattern: so lange (ms) alles, so lange eine Schlaufe; je Schlaufe so viel später; so weit pendelt das Ende (Grad). */
  ms: 900,
  loopMs: 520,
  wave: 80,
  swing: 16,
  /** Eine Schlaufe hebt sich: [Bruchteil ihrer Zeit, Höhe als Vielfaches]. */
  liftKeys: [[0, 1], [0.25, 1.75], [0.5, 0.78], [0.75, 1.14], [1, 1]] as Array<[number, number]>,
  /** Das Ende pendelt nur nach außen: [Bruchteil der Zeit, Ausschlag als Bruchteil von `swing`]. */
  swingKeys: [[0, 0], [0.2, 1], [0.42, 0], [0.6, 0.42], [0.78, 0], [0.9, 0.12], [1, 0]] as Array<[number, number]>,
};

/** Die Farben wie im Web: Vereinsblau, Gold, Pink, Grün, Violett, Orange - Band und Glanzstreifen. */
export const STREAMER_COLORS: Array<[string, string]> = [["#29B6E8", "#7fd6f5"], ["#FFD700", "#ffe866"], ["#ff4fa3", "#ff9ccb"], ["#3ddc84", "#8ff0bb"], ["#a66bff", "#cbb0ff"], ["#ff8a3d", "#ffbb8a"]];

type Box = { left: number; right: number; top: number; bottom: number };
export type StreamerLoop = { index: number; d: string; x: number };
export type CardStreamerPlan = {
  side: "left" | "right";
  corner: number;
  length: number;
  loops: StreamerLoop[];
  height: number;
  colors: [string, string];
  hang: { d: string; drop: number; x: number } | null;
  box: { lying: Box; hanging: Box | null };
  swing: number;
};

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const between = (rng: () => number, [lo, hi]: [number, number]) => lo + rng() * (hi - lo);

function pathOf(points: Array<[number, number]>): string {
  return `M ${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(" L ")}`;
}

/**
 * Die Luftschlange einer Karte (Karten-Koordinaten: x ab der linken Ecke, y = 0 die Oberkante, nach oben negativ).
 * `side` legt die Ecke fest (sonst aus der Saat), `hang: false` lässt das herabhängende Ende weg.
 */
export function cardStreamerPlan(width: number, seed = "streamer", { side = null, hang = true }: { side?: "left" | "right" | null; hang?: boolean } = {}): CardStreamerPlan {
  const rng = mulberry32(hashString(`cardstreamer:${seed}`));
  const chosen = rng() < 0.5 ? "left" : "right";
  const at = side || chosen;
  const length = Math.min(round(between(rng, CARD_STREAMER.lying)), Math.max(30, width * 0.45));
  const loops = CARD_STREAMER.loops[0] + Math.floor(rng() * (CARD_STREAMER.loops[1] - CARD_STREAMER.loops[0] + 1));
  const height = round(between(rng, CARD_STREAMER.height));
  const drop = round(between(rng, CARD_STREAMER.hang));
  const colors = STREAMER_COLORS[Math.floor(rng() * STREAMER_COLORS.length)];
  const turns = round(1.5 + rng());
  const curl = round(2 + rng() * 1.2);
  const inward = at === "left" ? 1 : -1;
  const corner = at === "left" ? 0 : width;
  const start = corner + inward * 3;
  // Schlaufen: eine verschlungene Zykloide - unten liegt das Band auf der Kante, oben kringelt es sich zurück.
  const step = length / (2 * Math.PI * loops);
  const back = step * 1.6;
  const loopPaths = Array.from({ length: loops }, (_, k) => {
    // Keine Locke ist wie die andere: jede etwas höher oder flacher.
    const lift = height * (0.8 + rng() * 0.35);
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= 18; i += 1) {
      const theta = 2 * Math.PI * (k + i / 18);
      points.push([start + inward * (step * theta + back * Math.sin(theta)), -(lift / 2) * (1 - Math.cos(theta)) - 0.9]);
    }
    const mid = start + inward * step * (2 * Math.PI * (k + 0.5));
    return { index: k, d: pathOf(points), x: round(mid) };
  });
  const out = corner - inward * CARD_STREAMER.out;
  const hangPoints: Array<[number, number]> = [[start, -0.9], [corner - inward * 0.6, -2.2], [out, 1.5]];
  for (let i = 1; i <= 16; i += 1) {
    const s = i / 16;
    hangPoints.push([out - inward * curl * Math.sin(2 * Math.PI * turns * s) * (0.35 + 0.65 * s), 1.5 + s * drop]);
  }
  const reach = back + 2;
  const xs = [start, start + inward * length];
  const lying = { left: round(Math.min(...xs) - reach), right: round(Math.max(...xs) + reach), top: round(-(height * 1.15 + 3)), bottom: 0 };
  const hanging = hang ? { left: round(Math.min(out, corner) - curl - 3), right: round(Math.max(out, corner) + curl + 3), top: -3, bottom: round(drop + 4) } : null;
  return {
    side: at,
    corner,
    length,
    loops: loopPaths,
    height,
    colors,
    hang: hang ? { d: pathOf(hangPoints), drop, x: corner } : null,
    box: { lying, hanging },
    swing: round(CARD_STREAMER.swing * (at === "left" ? 1 : -1)),
  };
}

function track(keys: Array<[number, number]>, t: number): number {
  const at = Math.max(0, Math.min(1, t));
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    if (at <= t1) return v0 + ((at - t0) / (t1 - t0)) * (v1 - v0);
  }
  return keys[keys.length - 1][1];
}

/** Wann eine Schlaufe zu flattern beginnt (ms nach dem Antippen) - die erste an der Ecke zuerst. */
export function loopDelay(index: number): number {
  return index * CARD_STREAMER.wave;
}

/** Das Flattern zur Zeit `ms`: je Schlaufe ihre Höhe als Vielfaches, dazu der Ausschlag des Endes in Grad. */
export function flutterAt(ms: number, plan: Pick<CardStreamerPlan, "loops" | "swing">): { loops: number[]; swing: number } {
  const t = Number(ms) || 0;
  const loops = plan.loops.map((loop) => round(track(CARD_STREAMER.liftKeys, (t - loopDelay(loop.index)) / CARD_STREAMER.loopMs), 3));
  return { loops, swing: round(track(CARD_STREAMER.swingKeys, t / CARD_STREAMER.ms) * plan.swing, 2) || 0 };
}

/** Eine Schlaufe als Animation über die ganze Dauer (0 bis 1): erst warten, dann heben, dann liegen. */
export function loopFrames(index: number): { inputRange: number[]; outputRange: number[] } {
  const start = loopDelay(index) / CARD_STREAMER.ms;
  const span = CARD_STREAMER.loopMs / CARD_STREAMER.ms;
  const keys = CARD_STREAMER.liftKeys.map(([t, v]) => [round(start + t * span, 4), v]);
  const head = keys[0][0] > 0 ? [[0, 1]] : [];
  const tail = keys[keys.length - 1][0] < 1 ? [[1, 1]] : [];
  const all = [...head, ...keys, ...tail];
  return { inputRange: all.map(([t]) => t), outputRange: all.map(([, v]) => v) };
}

/** Das Ende als Animation über die ganze Dauer (0 bis 1). */
export function swingFrames(swing: number): { inputRange: number[]; outputRange: string[] } {
  return { inputRange: CARD_STREAMER.swingKeys.map(([t]) => t), outputRange: CARD_STREAMER.swingKeys.map(([, v]) => `${round(v * swing, 2) || 0}deg`) };
}
