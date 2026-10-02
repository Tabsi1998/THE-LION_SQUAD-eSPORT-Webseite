// Silvester-Choreografie in der App (N2 #740): dieselbe Handschrift je Jahr wie im Web
// (frontend/src/seasons/newYear/choreography.js) - Zonen, Lieblingsart, Farbpaare, Muster der großen Salven. Wann eine
// Rakete steigt, sagt der Server (`data.salvos`); die App plant auf dem JS-Thread und reicht die Liste an die Ebene.

import { between, hashString, mulberry32, seasonRng } from "../rng";
import { SHELLS, SHELL_TYPES, type ColorName, type Launch, type ShellType } from "./fireworks";

export const SALVO_MINUTES = [0, 5, 10];
export const SALVO_PATTERNS = ["fan", "wave", "crown", "cascade"] as const;
export type SalvoPattern = (typeof SALVO_PATTERNS)[number];
export const COLOR_PAIRS: Array<[ColorName, ColorName]> = [["blue", "gold"], ["gold", "white"], ["blue", "silver"], ["red", "gold"], ["violet", "blue"], ["green", "gold"], ["white", "blue"], ["silver", "red"]];
export const SHOW_PHASES = new Set(["countdown", "show"]);

export type Hand = { year: string; zones: number[]; favorite: ShellType; weights: Record<ShellType, number>; pairs: Array<[ColorName, ColorName]>; salvos: SalvoPattern[] };

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function handwriting(year: number | string): Hand {
  const rng = seasonRng({ season: "new_year", year, screen: "show" }, "hand");
  const zoneCount = 4 + Math.floor(rng() * 3);
  const zones = Array.from({ length: zoneCount }, (_, i) => round3(0.12 + (0.76 * (i + 0.5)) / zoneCount + between(rng, -0.035, 0.035)));
  const favorite = SHELL_TYPES.filter((type) => type !== "heart")[Math.floor(rng() * 5)];
  const weights: Record<ShellType, number> = { peony: 3, chrysanthemum: 3, willow: 2, crackle: 2, ring: 1.4, heart: 0.35 };
  weights[favorite] += 2;
  const pairs = shuffle(COLOR_PAIRS, rng).slice(0, 5);
  const salvos: SalvoPattern[] = [];
  SALVO_MINUTES.forEach(() => {
    let pattern = SALVO_PATTERNS[Math.floor(rng() * SALVO_PATTERNS.length)];
    if (pattern === salvos[salvos.length - 1]) pattern = SALVO_PATTERNS[(SALVO_PATTERNS.indexOf(pattern) + 1) % SALVO_PATTERNS.length];
    salvos.push(pattern);
  });
  return { year: String(year), zones, favorite, weights, pairs, salvos };
}

export function pickType(hand: Hand, rng: () => number, phase: string): ShellType {
  const show = SHOW_PHASES.has(phase);
  const entries = SHELL_TYPES.map((type) => [type, type === "heart" && !show ? 0 : type === "ring" && !show ? hand.weights.ring * 0.5 : hand.weights[type]] as const);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return entries[0][0];
}

export function makeLaunch(hand: Hand, seed: string, phase: string, at: number): Launch {
  const rng = mulberry32(hashString(`launch:${hand.year}:${seed}`));
  const show = SHOW_PHASES.has(phase);
  const type = pickType(hand, rng, phase);
  const shell = SHELLS[type];
  const zone = hand.zones[Math.floor(rng() * hand.zones.length)];
  const distance = round3(show ? between(rng, 0.05, 0.85) : between(rng, 0.45, 1));
  const pair = hand.pairs[Math.floor(rng() * hand.pairs.length)];
  const colors: [ColorName, ColorName] = type === "willow" ? ["gold", rng() < 0.5 ? "gold" : pair[1]] : type === "heart" ? ["red", "white"] : [pair[0], pair[1]];
  return {
    id: String(seed),
    at,
    type,
    x: round3(Math.max(0.05, Math.min(0.95, zone + between(rng, -0.03, 0.03)))),
    distance,
    colors,
    // Nicht zu hoch: auch die obersten Sterne bleiben unter der Kopfzeile (Bedienung frei).
    burstY: round3(0.25 + 0.2 * distance + between(rng, -0.03, 0.03)),
    rise: round3(between(rng, shell.rise[0], shell.rise[1]) * (1 - 0.12 * distance)),
    drift: round3(between(rng, -26, 26)),
  };
}

export function planHour(hand: Hand, { hourSeed, salvos = [], phase, hourStart = 0 }: { hourSeed: number | string; salvos?: number[]; phase: string; hourStart?: number }): Launch[] {
  return salvos.map((second, index) => makeLaunch(hand, `${hourSeed}:${index}`, phase, hourStart + second * 1000));
}

export function salvoLaunches(hand: Hand, index: number, at: number): Launch[] {
  const pattern = hand.salvos[index % hand.salvos.length];
  const zones = hand.zones;
  const middle = zones[Math.floor(zones.length / 2)];
  const base = (n: number, phase = "show") => makeLaunch(hand, `salvo:${index}:${n}`, phase, at);
  const out: Launch[] = [];
  if (pattern === "fan") {
    for (let n = 0; n < 7; n += 1) out.push({ ...base(n), x: middle, drift: round3(-96 + n * 32), distance: 0.15, at: at + n * 120 });
  } else if (pattern === "wave") {
    zones.forEach((zone, n) => out.push({ ...base(n), x: zone, distance: 0.25, at: at + n * 280 }));
    zones.slice(0, -1).reverse().forEach((zone, n) => out.push({ ...base(zones.length + n), x: zone, distance: 0.4, at: at + (zones.length + n) * 280 }));
  } else if (pattern === "crown") {
    zones.forEach((zone, n) => out.push({ ...base(n), x: zone, distance: 0.3, at }));
    out.push({ ...base(zones.length), type: "willow", colors: ["gold", "gold"], x: middle, distance: 0.1, at: at + 420 });
  } else {
    for (let wave = 0; wave < 3; wave += 1) {
      zones.forEach((zone, n) => out.push({ ...base(wave * zones.length + n), type: "willow", colors: ["gold", wave === 1 ? "white" : "gold"], x: zone, distance: round3(0.2 + wave * 0.2), at: at + wave * 800 + n * 90 }));
    }
  }
  return out.map((launch, n) => ({ ...launch, id: `salvo:${index}:${n}`, pattern }));
}

/** Wie im Web: 00:00, 00:05, 00:10 - oder die Abstände der Probe-Show in Sekunden (`salvo_seconds`). */
export function salvoTimes(showStart: number, seconds: number[] | null = null): number[] {
  const offsets = Array.isArray(seconds) && seconds.length ? seconds.map((second) => second * 1000) : SALVO_MINUTES.map((minute) => minute * 60000);
  return offsets.map((offset) => showStart + offset);
}
