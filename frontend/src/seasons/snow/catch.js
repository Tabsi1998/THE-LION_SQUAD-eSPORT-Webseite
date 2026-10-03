// Die gefangene Schneeflocke (W5 #731): je nach echter Temperatur am Vereinsort bricht der Kristall in Splitter
// (Frost) oder schmilzt zu einem Tropfen (Tauwetter); dazwischen wechselt es von Fang zu Fang. Reine Rechnung - die
// App rechnet dasselbe (mobile/src/seasons/snow/catch.ts, Paritätstest). Gefangen zählt beides gleich.

/** Ab hier schmilzt jede Flocke; bis 0 °C bricht jede; dazwischen wechselt es. */
export const MELT_FROM_C = 2;

/** Bricht der Kristall oder schmilzt er? `tempC` aus dem Wetter (oder null), `clicks` die Fänge bisher. */
export function catchStyle(tempC, clicks = 0) {
  const temp = tempC === null || tempC === undefined || tempC === "" ? NaN : Number(tempC);
  if (!Number.isFinite(temp) || temp <= 0) return "break";
  if (temp >= MELT_FROM_C) return "melt";
  return Math.abs(Math.round(clicks)) % 2 === 0 ? "melt" : "break";
}

const round = (value) => Math.round(value * 100) / 100;

/**
 * Die Splitter eines brechenden Kristalls: je Arm ein langer Splitter, der entlang des Arms davonfliegt und sich dabei
 * dreht, dazwischen sechs kleine Bruchstücke. `dx`/`dy` in Pixeln vom Mittelpunkt, `turn` in Grad, `angle` die
 * Richtung des Arms (0° = oben, im Uhrzeigersinn).
 */
export function breakShards() {
  const slivers = Array.from({ length: 6 }, (_, i) => {
    const angle = i * 60;
    const rad = ((angle - 90) * Math.PI) / 180;
    const distance = 15 + (i % 2) * 4;
    return { kind: "sliver", angle, dx: round(Math.cos(rad) * distance), dy: round(Math.sin(rad) * distance), turn: i % 2 === 0 ? 38 : -32 };
  });
  const chips = Array.from({ length: 6 }, (_, i) => {
    const angle = i * 60 + 30;
    const rad = ((angle - 90) * Math.PI) / 180;
    const distance = 10 + (i % 3) * 3;
    return { kind: "chip", angle, dx: round(Math.cos(rad) * distance), dy: round(Math.sin(rad) * distance) + 4, turn: 90 + i * 25 };
  });
  return [...slivers, ...chips];
}

/** Der Tropfen beim Schmelzen: wie weit er fällt (px) und wie lange es dauert (ms), dazu der Ring am Ende. */
export const MELT = { fall: 11, ms: 900, ripple: 9 };
