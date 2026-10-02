// Die gefangene Schneeflocke in der App (W5 #731) - dieselbe Rechnung wie `frontend/src/seasons/snow/catch.js`
// (Paritätstest): bei Frost bricht der Kristall in Splitter, bei Tauwetter schmilzt er zu einem Tropfen, dazwischen
// wechselt es von Fang zu Fang. Gefangen zählt beides gleich.

/** Ab hier schmilzt jede Flocke; bis 0 °C bricht jede; dazwischen wechselt es. */
export const MELT_FROM_C = 2;

export type CatchStyle = "break" | "melt";
export type Shard = { kind: "sliver" | "chip"; angle: number; dx: number; dy: number; turn: number };

/** Bricht der Kristall oder schmilzt er? `tempC` aus dem Wetter (oder null), `clicks` die Fänge bisher. */
export function catchStyle(tempC: number | string | null | undefined, clicks = 0): CatchStyle {
  const temp = tempC === null || tempC === undefined || tempC === "" ? NaN : Number(tempC);
  if (!Number.isFinite(temp) || temp <= 0) return "break";
  if (temp >= MELT_FROM_C) return "melt";
  return Math.abs(Math.round(clicks)) % 2 === 0 ? "melt" : "break";
}

const round = (value: number) => Math.round(value * 100) / 100;

/** Die Splitter: je Arm ein langer, entlang des Arms (0° = oben, im Uhrzeigersinn), dazwischen sechs kleine. */
export function breakShards(): Shard[] {
  const slivers: Shard[] = Array.from({ length: 6 }, (_, i) => {
    const angle = i * 60;
    const rad = ((angle - 90) * Math.PI) / 180;
    const distance = 15 + (i % 2) * 4;
    return { kind: "sliver", angle, dx: round(Math.cos(rad) * distance), dy: round(Math.sin(rad) * distance), turn: i % 2 === 0 ? 38 : -32 };
  });
  const chips: Shard[] = Array.from({ length: 6 }, (_, i) => {
    const angle = i * 60 + 30;
    const rad = ((angle - 90) * Math.PI) / 180;
    const distance = 10 + (i % 3) * 3;
    return { kind: "chip", angle, dx: round(Math.cos(rad) * distance), dy: round(Math.sin(rad) * distance) + 4, turn: 90 + i * 25 };
  });
  return [...slivers, ...chips];
}

/** Der Tropfen beim Schmelzen: wie weit er fällt (px) und wie lange es dauert (ms), dazu der Ring am Ende. */
export const MELT = { fall: 11, ms: 900, ripple: 9 };
