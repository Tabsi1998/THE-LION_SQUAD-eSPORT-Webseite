// Die Lichterkette schwingt nach (Jahreszeiten IV, #1091): Hebt sich die Karte, an der eine Kette hängt, springen die
// Nägel mit der Karte 5 px hoch - der Draht bleibt kurz zurück, hängt tiefer durch, federt hoch und schwingt zweimal
// nach, gut eine Sekunde lang. Die Lämpchen pendeln dabei ein wenig um ihre Fassung, ein einzelnes Licht flackert
// einmal. Beim Loslassen dasselbe in klein. Danach hängt die Kette wieder genau wie vorher. Reine Rechnung; die Anzeige
// liegt in LightChain.jsx (die Keyframes in christmas.css folgen SWING.keys), die App rechnet dasselbe
// (mobile/src/seasons/christmas/swing.ts, Paritätstest auf beiden Seiten).

import { hashString, mulberry32 } from "../rng";

export const SWING = {
  /** So lange schwingt die Kette nach (ms). */
  ms: 1100,
  /** Beim Loslassen dasselbe in klein: so viel vom Ausschlag. */
  leave: 0.45,
  /**
   * Der Durchhang über die Zeit: [Bruchteil der Dauer, wie viel tiefer (positiv) oder höher (negativ) als in Ruhe, als
   * Bruchteil der Tiefe]. Zweimal hin und her, jedes Mal kleiner - am Ende genau wie vorher.
   */
  keys: [[0, 0], [0.16, 0.34], [0.38, -0.2], [0.6, 0.12], [0.8, -0.05], [1, 0]],
  /** So weit pendelt ein Lämpchen beim ersten Ausschlag zur Seite (Grad). */
  tilt: 7,
  /** Das eine Licht, das flackert: so lange (ms), so spät nach dem Anheben (ms). */
  blinkMs: 600,
  blinkAt: 140,
};

const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits;

/** Der Ausschlag zur Zeit `ms` (linear zwischen den Stützstellen), `amp` 1 beim Anheben, SWING.leave beim Loslassen. */
export function swingAt(ms, amp = 1) {
  const t = Math.max(0, Math.min(1, (Number(ms) || 0) / SWING.ms));
  for (let i = 1; i < SWING.keys.length; i += 1) {
    const [t0, v0] = SWING.keys[i - 1];
    const [t1, v1] = SWING.keys[i];
    if (t <= t1) return round((v0 + ((t - t0) / (t1 - t0)) * (v1 - v0)) * amp, 4);
  }
  return 0;
}

/** Die Neigung eines Lämpchens zur Zeit `ms`: folgt dem Ausschlag, beim ersten Höchststand genau `tilt`. */
export function tiltAt(ms, tilt, amp = 1) {
  return round((swingAt(ms, amp) / SWING.keys[1][1]) * tilt, 3);
}

/**
 * Was eine Kette bei einem Anheben tut: je Lämpchen, wie tief seine Fassung unter der Nagellinie (y = 1) hängt - so weit
 * zieht der Durchhang es mit (`h`) -, wie weit und wohin es pendelt (`tilt`, Grad), und welches eine Licht flackert
 * (`blink`, Nummer des Lämpchens). `seed` macht jede Kette und jedes Anheben anders.
 */
export function swingPlan(bulbs = [], seed = "swing") {
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
