// Silvester-Choreografie (N2, #740): jedes Jahr eine eigene Handschrift aus dem Jahres-Seed (C4) - Abschusszonen,
// eine Lieblingsart, Farbpaare, die Muster der drei großen Salven - und innerhalb des Jahres stabil, auch nach einem
// Neuladen. WANN eine Rakete steigt, sagt der Server (Sekunden je Stunde aus seiner Saat, `data.salvos`, für alle
// Geräte gleich); WIE sie aussieht, sagt die Handschrift. Keine Jahreszahl steht im Code.

import { between, hashString, mulberry32, seasonRng } from "../rng";
import { SHELLS, SHELL_TYPES } from "./fireworks";

/** Die großen Salven der Show: um 00:00, 00:05 und 00:10 - jede mit eigenem Muster. */
export const SALVO_MINUTES = [0, 5, 10];
export const SALVO_PATTERNS = ["fan", "wave", "crown", "cascade"];
/** Farbpaare (Haupt- und Zweitfarbe); die Handschrift wählt fünf und ihre Reihenfolge. */
export const COLOR_PAIRS = [["blue", "gold"], ["gold", "white"], ["blue", "silver"], ["red", "gold"], ["violet", "blue"], ["green", "gold"], ["white", "blue"], ["silver", "red"]];
/** Phasen der Show: dort steigen auch nahe Raketen und Herzen; in der Rampe eher ferne, schlichte. */
export const SHOW_PHASES = new Set(["countdown", "show"]);

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function shuffle(items, rng) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Die Handschrift eines Jahres: Zonen (4–6), Lieblingsart (nie das Herz), Gewichte, fünf Farbpaare, drei Salvenmuster. */
export function handwriting(year) {
  const rng = seasonRng({ season: "new_year", year, route: "show" }, "hand");
  const zoneCount = 4 + Math.floor(rng() * 3);
  const zones = Array.from({ length: zoneCount }, (_, i) => round3(0.12 + (0.76 * (i + 0.5)) / zoneCount + between(rng, -0.035, 0.035)));
  const favorite = SHELL_TYPES.filter((type) => type !== "heart")[Math.floor(rng() * 5)];
  const weights = { peony: 3, chrysanthemum: 3, willow: 2, crackle: 2, ring: 1.4, heart: 0.35 };
  weights[favorite] += 2;
  const pairs = shuffle(COLOR_PAIRS, rng).slice(0, 5);
  // Drei Salven, nie zweimal dasselbe Muster direkt hintereinander.
  const salvos = [];
  SALVO_MINUTES.forEach(() => {
    let pattern = SALVO_PATTERNS[Math.floor(rng() * SALVO_PATTERNS.length)];
    if (pattern === salvos[salvos.length - 1]) pattern = SALVO_PATTERNS[(SALVO_PATTERNS.indexOf(pattern) + 1) % SALVO_PATTERNS.length];
    salvos.push(pattern);
  });
  return { year: String(year), zones, favorite, weights, pairs, salvos };
}

/** Eine Art nach den Gewichten des Jahres - in der Rampe ohne Herz und mit weniger Ringen. */
export function pickType(hand, rng, phase) {
  const show = SHOW_PHASES.has(phase);
  const entries = SHELL_TYPES.map((type) => [type, type === "heart" && !show ? 0 : type === "ring" && !show ? hand.weights.ring * 0.5 : hand.weights[type]]);
  const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
  let roll = rng() * total;
  for (const [type, weight] of entries) {
    roll -= weight;
    if (roll < 0) return type;
  }
  return entries[0][0];
}

/**
 * Eine Rakete: Zone der Handschrift (leicht versetzt), Entfernung (in der Rampe eher fern, in der Show auch nah), Art,
 * Farbpaar, Höhe des Zerplatzens (ferne tiefer), Aufstieg je Art, eine kleine eigene Abweichung. `seed` macht sie fest.
 */
export function makeLaunch(hand, seed, phase, at) {
  const rng = mulberry32(hashString(`launch:${hand.year}:${seed}`));
  const show = SHOW_PHASES.has(phase);
  const type = pickType(hand, rng, phase);
  const shell = SHELLS[type];
  const zone = hand.zones[Math.floor(rng() * hand.zones.length)];
  const distance = round3(show ? between(rng, 0.05, 0.85) : between(rng, 0.45, 1));
  const pair = hand.pairs[Math.floor(rng() * hand.pairs.length)];
  const colors = type === "willow" ? ["gold", rng() < 0.5 ? "gold" : pair[1]] : type === "heart" ? ["red", "white"] : [pair[0], pair[1]];
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

/**
 * Die Raketen einer Stunde: je Startsekunde des Servers eine, fest aus Jahr, Stundensaat und Platz in der Liste.
 * `hourStart` in ms (Serverzeit); `at` ist dann die Startzeit in ms.
 */
export function planHour(hand, { hourSeed, salvos = [], phase, hourStart = 0 }) {
  return salvos.map((second, index) => makeLaunch(hand, `${hourSeed}:${index}`, phase, hourStart + second * 1000));
}

/**
 * Eine große Salve (00:00, 00:05, 00:10) nach ihrem Muster: Fächer aus der Mitte, Welle über alle Zonen hin und
 * zurück, Krone (alle Zonen zugleich, dann eine Weide in der Mitte), Kaskade (drei Wellen goldener Weiden).
 */
export function salvoLaunches(hand, index, at) {
  const pattern = hand.salvos[index % hand.salvos.length];
  const zones = hand.zones;
  const middle = zones[Math.floor(zones.length / 2)];
  const base = (n, phase = "show") => makeLaunch(hand, `salvo:${index}:${n}`, phase, at);
  const out = [];
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

/**
 * Die Startzeiten der großen Salven (ms, Serverzeit) aus dem Beginn der Show - um 00:00, 00:05 und 00:10. Die
 * Probe-Show der Vorschau schickt eigene Abstände in Sekunden (`salvo_seconds`), damit alles in eine Minute passt.
 */
export function salvoTimes(showStart, seconds = null) {
  const offsets = Array.isArray(seconds) && seconds.length ? seconds.map((second) => second * 1000) : SALVO_MINUTES.map((minute) => minute * 60000);
  return offsets.map((offset) => showStart + offset);
}
