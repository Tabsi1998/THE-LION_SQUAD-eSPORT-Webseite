// Luftschlangen an Karten (Jahreszeiten IV, Variante B, #1093): Neben den Luftschlangen am oberen Seitenrand liegt auf
// der Oberkante einiger Karten eine Luftschlange - in Schlaufen gekringelt, an einer Ecke hängt ihr Ende über die Kante
// herab, außen neben der Karte. Hebt sich die Karte, flattert sie einmal durch: eine Welle hebt die Schlaufen
// nacheinander an, das Ende pendelt, dann liegt sie wieder genau wie vorher. Reine Rechnung (Form, Farben, Zeiten); die
// Anzeige liegt in CardStreamers.jsx (die Keyframes in carnival.css folgen CARD_STREAMER), die App rechnet dasselbe
// (mobile/src/seasons/carnival/cardStreamer.ts, Paritätstest auf beiden Seiten).

import { hashString, mulberry32 } from "../rng";

export const CARD_STREAMER = {
  /** So lang liegt sie auf der Kante (px), so viele Schlaufen, so hoch sind sie (px). */
  lying: [54, 104],
  loops: [2, 4],
  height: [5, 7.5],
  /** So weit hängt das Ende über die Ecke herab (px), so weit steht es außen von der Karte ab (px). */
  hang: [16, 32],
  out: 4,
  /** So breit ist das Band (px). */
  stroke: 2.6,
  /** Flattern: so lange (ms) alles, so lange eine Schlaufe; je Schlaufe so viel später (ms); so weit pendelt das Ende (Grad). */
  ms: 900,
  loopMs: 520,
  wave: 80,
  swing: 16,
  /** Eine Schlaufe hebt sich: [Bruchteil ihrer Zeit, Höhe als Vielfaches]. */
  liftKeys: [[0, 1], [0.25, 1.75], [0.5, 0.78], [0.75, 1.14], [1, 1]],
  /**
   * Das Ende pendelt: [Bruchteil der Zeit, Ausschlag als Bruchteil von `swing`] - nur nach außen: die Seite der Karte ist
   * gleich daneben, dort federt es zurück.
   */
  swingKeys: [[0, 0], [0.2, 1], [0.42, 0], [0.6, 0.42], [0.78, 0], [0.9, 0.12], [1, 0]],
};

/** Die Farben der Luftschlangen am Rand: Vereinsblau, Gold, Pink, Grün, Violett, Orange - Band und Glanzstreifen. */
export const STREAMER_COLORS = [["#29B6E8", "#7fd6f5"], ["#FFD700", "#ffe866"], ["#ff4fa3", "#ff9ccb"], ["#3ddc84", "#8ff0bb"], ["#a66bff", "#cbb0ff"], ["#ff8a3d", "#ffbb8a"]];

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;
const between = (rng, [lo, hi]) => lo + rng() * (hi - lo);

function pathOf(points) {
  return `M ${points.map(([x, y]) => `${round(x)} ${round(y)}`).join(" L ")}`;
}

/**
 * Die Luftschlange einer Karte (Karten-Koordinaten: x ab der linken Ecke, y = 0 die Oberkante, nach oben negativ).
 * `side` legt die Ecke fest (sonst aus der Saat), `hang: false` lässt das herabhängende Ende weg. Liefert die Schlaufen
 * einzeln (für die Welle), das Ende, Farben und Kästen für die Prüfung, ob dort Platz ist.
 */
export function cardStreamerPlan(width, seed = "streamer", { side = null, hang = true } = {}) {
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
  // Schlaufen: eine verschlungene Zykloide - unten liegt das Band auf der Kante, oben kringelt es sich zurück (wie ein
  // ausgerolltes Band, das noch seine Locken hat).
  const step = length / (2 * Math.PI * loops);
  const back = step * 1.6;
  const loopPaths = Array.from({ length: loops }, (_, k) => {
    // Keine Locke ist wie die andere: jede etwas höher oder flacher.
    const lift = height * (0.8 + rng() * 0.35);
    const points = [];
    for (let i = 0; i <= 18; i += 1) {
      const theta = 2 * Math.PI * (k + i / 18);
      points.push([start + inward * (step * theta + back * Math.sin(theta)), -(lift / 2) * (1 - Math.cos(theta)) - 0.9]);
    }
    const mid = start + inward * step * (2 * Math.PI * (k + 0.5));
    return { index: k, d: pathOf(points), x: round(mid) };
  });
  const out = corner - inward * CARD_STREAMER.out;
  const hangPoints = [[start, -0.9], [corner - inward * 0.6, -2.2], [out, 1.5]];
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

function track(keys, t) {
  const at = Math.max(0, Math.min(1, t));
  for (let i = 1; i < keys.length; i += 1) {
    const [t0, v0] = keys[i - 1];
    const [t1, v1] = keys[i];
    if (at <= t1) return v0 + ((at - t0) / (t1 - t0)) * (v1 - v0);
  }
  return keys[keys.length - 1][1];
}

/** Wann eine Schlaufe zu flattern beginnt (ms nach dem Anheben) - die erste an der Ecke zuerst. */
export function loopDelay(index) {
  return index * CARD_STREAMER.wave;
}

/**
 * Das Flattern zur Zeit `ms` (für Tests und die App; im Web machen es die Keyframes): je Schlaufe ihre Höhe als
 * Vielfaches, dazu der Ausschlag des Endes in Grad.
 */
export function flutterAt(ms, plan) {
  const t = Number(ms) || 0;
  const loops = plan.loops.map((loop) => round(track(CARD_STREAMER.liftKeys, (t - loopDelay(loop.index)) / CARD_STREAMER.loopMs), 3));
  return { loops, swing: round(track(CARD_STREAMER.swingKeys, t / CARD_STREAMER.ms) * plan.swing, 2) || 0 };
}
