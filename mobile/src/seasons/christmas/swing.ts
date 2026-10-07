// Die Lichterkette schwingt nach (Jahreszeiten IV, #1091) - dieselbe Rechnung wie im Web
// (frontend/src/seasons/christmas/swing.js, Paritätstest auf beiden Seiten): Wird die Karte angetippt, an der eine Kette
// hängt, hängt der Draht kurz tiefer durch, federt hoch und schwingt zweimal nach, gut eine Sekunde lang. Die Lämpchen
// ziehen mit und pendeln ein wenig, ein einzelnes Licht flackert einmal. Danach hängt die Kette wieder genau wie vorher.
// Reine Rechnung; die Anzeige liegt in LightChain.tsx.

import { hashString, mulberry32 } from "../rng";
import type { Bulb } from "./lights";

export const SWING = {
  /** So lange schwingt die Kette nach (ms). */
  ms: 1100,
  /** Beim Loslassen dasselbe in klein (nur im Web - am Handy ist Antippen und Loslassen eins). */
  leave: 0.45,
  /** Der Durchhang über die Zeit: [Bruchteil der Dauer, wie viel tiefer (positiv) oder höher (negativ) als in Ruhe]. */
  keys: [[0, 0], [0.16, 0.34], [0.38, -0.2], [0.6, 0.12], [0.8, -0.05], [1, 0]] as Array<[number, number]>,
  /** So weit pendelt ein Lämpchen beim ersten Ausschlag zur Seite (Grad). */
  tilt: 7,
  /** Das eine Licht, das flackert: so lange (ms), so spät nach dem Antippen (ms). */
  blinkMs: 600,
  blinkAt: 140,
};

export type SwingBulb = { index: number; h: number; tilt: number };
export type SwingPlan = { blink: number | null; bulbs: SwingBulb[] };

const round = (value: number, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Der Ausschlag zur Zeit `ms` (linear zwischen den Stützstellen), `amp` 1 beim Antippen. */
export function swingAt(ms: number, amp = 1): number {
  const t = Math.max(0, Math.min(1, (Number(ms) || 0) / SWING.ms));
  for (let i = 1; i < SWING.keys.length; i += 1) {
    const [t0, v0] = SWING.keys[i - 1];
    const [t1, v1] = SWING.keys[i];
    if (t <= t1) return round((v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)) * amp, 4);
  }
  return 0;
}

/** Die Neigung eines Lämpchens zur Zeit `ms`: folgt dem Ausschlag, beim ersten Höchststand genau `tilt`. */
export function tiltAt(ms: number, tilt: number, amp = 1): number {
  return round((swingAt(ms, amp) / SWING.keys[1][1]) * tilt, 3);
}

/**
 * Was eine Kette bei einem Antippen tut: je Lämpchen, wie tief seine Fassung unter der Nagellinie hängt (`h`), wie weit
 * und wohin es pendelt (`tilt`), und welches eine Licht flackert (`blink`). `seed` macht jedes Antippen anders.
 */
export function swingPlan(bulbs: Array<Pick<Bulb, "index" | "y" | "radius">> = [], seed = "swing"): SwingPlan {
  const rng = mulberry32(hashString(`chainswing:${seed}`));
  const blink = bulbs.length ? bulbs[Math.floor(rng() * bulbs.length)].index : null;
  return {
    blink,
    bulbs: bulbs.map((bulb) => ({
      index: bulb.index,
      h: round(Math.max(0, bulb.y - bulb.radius - 1)),
      tilt: round(SWING.tilt * (0.6 + rng() * 0.4) * (rng() < 0.5 ? -1 : 1)),
    })),
  };
}

/** Die Stützstellen als Eingabe für eine Animation (0 bis 1) - für den Durchhang, das Mitziehen und das Pendeln. */
export function swingFrames(scale: number): { inputRange: number[]; outputRange: number[] } {
  return { inputRange: SWING.keys.map(([t]) => t), outputRange: SWING.keys.map(([, v]) => round(v * scale, 4)) };
}

/** Das Flackern des einen Lichts als Faktor auf seine Helligkeit, über die ganze Dauer (0 bis 1). */
export function blinkFrames(): { inputRange: number[]; outputRange: number[] } {
  const at = (share: number) => round((SWING.blinkAt + share * SWING.blinkMs) / SWING.ms, 4);
  return { inputRange: [0, at(0), at(0.2), at(0.4), at(0.6), at(0.8), at(1), 1], outputRange: [1, 1, 0.25, 1, 0.4, 1, 1, 1] };
}
