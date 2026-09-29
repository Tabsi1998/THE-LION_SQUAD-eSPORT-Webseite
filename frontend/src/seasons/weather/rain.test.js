import { GRAVITY, MAX_ALPHA, RAIN_BUDGET, RAIN_DEPTHS, RAIN_ORDER, SIDE_MARGIN, advanceDrop, createDrop, createSplash, crossedEdge, driftOf, dropCounts, rainFactor, rainLabel, scrollDrop, splashPoints } from "./rain";
import { mulberry32 } from "../rng";

// Regen (#673): Menge aus dem Wetter, drei Tiefen klar verschieden, nie deckender als 0,35, schräg nach Wind, die
// Tropfen gehören zur Seite, ein Teil landet auf Kanten mit einem Spritzer, nachlassender Regen läuft aus.

const SIZE = { width: 1200, height: 800 };

test("Menge aus dem Wetter: kein Regen, Niesel, leicht, Regen, stark - in Zahl und Wort", () => {
  expect(rainFactor(null)).toBe(0);
  expect(rainFactor({ rain_mm: 0 })).toBe(0);
  expect(rainFactor({ rain_mm: 0.1 })).toBe(0.35);
  expect(rainFactor({ rain_mm: 0.8 })).toBe(0.65);
  expect(rainFactor({ rain_mm: 2.5 })).toBe(1);
  expect(rainFactor({ rain_mm: 9 })).toBe(1.2);
  expect(rainFactor({ rain_mm: "x" })).toBe(0);
  expect([0, 0.1, 0.8, 2.5, 9].map((mm) => rainLabel({ rain_mm: mm }))).toEqual(["kein Regen", "Nieselregen", "leichter Regen", "Regen", "starker Regen"]);
});

test("Zahl der Tropfen: Budget mal Seite mal Menge, nachts ruhiger, Anteile je Tiefe", () => {
  expect(dropCounts(100, { factor: 1 })).toEqual({ back: 60, mid: 38, front: 22, total: Math.round(100 * RAIN_BUDGET) });
  expect(dropCounts(100, { factor: 0.35 }).total).toBe(42);
  expect(dropCounts(100, { factor: 1, share: 0.6 }).total).toBe(72);
  expect(dropCounts(100, { factor: 1, night: true }).total).toBe(96);
  expect(dropCounts(100, { factor: 0 }).total).toBe(0);
  expect(dropCounts(0, { factor: 1 }).total).toBe(0);
  // Große Fenster: mehr Tropfen für dieselbe Dichte - nie weniger als ohne den Faktor.
  expect(dropCounts(100, { factor: 1, area: 2 }).total).toBe(240);
  expect(dropCounts(100, { factor: 1, area: 1.6 }).total).toBe(192);
  expect(dropCounts(100, { factor: 1, area: 0.3 }).total).toBe(120);
});

test("drei Tiefen: hinten kurz, blass und langsamer, vorne lang, heller und schnell - nie deckender als 0,35; nur vordere spritzen", () => {
  const rng = mulberry32(5);
  const back = Array.from({ length: 60 }, () => createDrop("back", SIZE, rng));
  const front = Array.from({ length: 60 }, () => createDrop("front", SIZE, rng));
  const avg = (items, key) => items.reduce((sum, item) => sum + item[key], 0) / items.length;
  expect(avg(back, "length")).toBeLessThan(avg(front, "length"));
  expect(avg(back, "speed")).toBeLessThan(avg(front, "speed"));
  expect(avg(back, "alpha")).toBeLessThan(avg(front, "alpha"));
  [...back, ...front].forEach((drop) => {
    expect(drop.alpha).toBeLessThanOrEqual(MAX_ALPHA);
    expect(drop.x).toBeGreaterThanOrEqual(-SIDE_MARGIN);
    expect(drop.x).toBeLessThanOrEqual(SIZE.width + SIDE_MARGIN);
    expect(drop.y).toBeLessThan(0);
  });
  expect(back.some((drop) => drop.splashes)).toBe(false);
  expect(front.some((drop) => drop.splashes)).toBe(true);
  expect(front.some((drop) => !drop.splashes)).toBe(true);
  expect(createDrop("mid", SIZE, rng, { anywhere: true }).y).toBeGreaterThanOrEqual(0);
  expect(RAIN_ORDER).toEqual(["back", "mid", "front"]);
  expect(new Set(front.map((drop) => drop.speed.toFixed(3))).size).toBe(60);
});

test("Schritt: fällt schnell, treibt mit dem Wind (vorne mehr), unten hinaus kommt er oben neu - nachlassender Regen läuft aus", () => {
  const drop = { depth: "front", x: 600, y: 100, length: 20, speed: 1000, alpha: 0.25, width: 1.3, splashes: false };
  const wind = { x: 40, y: 6, strength: 1 };
  const previous = advanceDrop(drop, 0.1, wind, SIZE, () => 0.5);
  expect(previous).toBe(100);
  expect(drop.y).toBeCloseTo(200, 5);
  expect(drop.x).toBeCloseTo(600 + 40 * RAIN_DEPTHS.front.wind * 0.1, 5);
  expect(driftOf({ depth: "back" }, wind)).toBeLessThan(driftOf({ depth: "front" }, wind));
  expect(driftOf(drop, { x: -40 })).toBeLessThan(0);
  const low = { ...drop, y: SIZE.height + 10 };
  advanceDrop(low, 0.1, wind, SIZE, () => 0.5);
  expect(low.y).toBeLessThan(0);
  expect(low.done).toBeUndefined();
  const leaving = { ...drop, y: SIZE.height + 10, leaving: true };
  advanceDrop(leaving, 0.1, wind, SIZE, () => 0.5);
  expect(leaving.done).toBe(true);
});

test("Scrollen: die Tropfen gehören zur Seite - vorne ganz, hinten weniger, Sprünge bleiben im Bild", () => {
  const front = { depth: "front", x: 300, y: 400, length: 20 };
  const back = { depth: "back", x: 300, y: 400, length: 10 };
  scrollDrop(front, 100, SIZE);
  scrollDrop(back, 100, SIZE);
  expect(front).toMatchObject({ x: 300, y: 300 });
  expect(back.y).toBeCloseTo(400 - 100 * RAIN_DEPTHS.back.scroll, 5);
  expect(scrollDrop({ ...front }, 0, SIZE).y).toBe(300);
  [6000, -7500].forEach((jump) => {
    const drop = { depth: "front", x: 300, y: 200, length: 20 };
    scrollDrop(drop, jump, SIZE, () => 0.5);
    expect(drop.y).toBeGreaterThanOrEqual(-40);
    expect(drop.y).toBeLessThan(SIZE.height + 40);
  });
});

test("Kanten und Spritzer: ein Tropfen landet nur, wenn er spritzen darf, die Kante kreuzt und über ihr liegt; der Spritzer springt auf und vergeht", () => {
  const edges = [{ x1: 100, x2: 400, y: 300, key: "card:1" }, { x1: 500, x2: 900, y: 520, key: "card:2" }];
  const drop = { depth: "front", x: 250, y: 305, length: 20, splashes: true };
  expect(crossedEdge(drop, 290, edges)).toBe(edges[0]);
  expect(crossedEdge(drop, 301, edges)).toBeNull();
  expect(crossedEdge({ ...drop, x: 450 }, 290, edges)).toBeNull();
  expect(crossedEdge({ ...drop, splashes: false }, 290, edges)).toBeNull();
  expect(crossedEdge({ ...drop, x: 700, y: 530 }, 510, edges)).toBe(edges[1]);
  expect(crossedEdge(drop, 290)).toBeNull();
  const splash = createSplash(250, 300, mulberry32(3));
  expect(splash.parts).toHaveLength(3);
  expect(splash.life).toBeGreaterThan(0.25);
  splash.age = 0.05;
  const early = splashPoints(splash);
  expect(early).toHaveLength(3);
  early.forEach((point) => {
    expect(point.y).toBeLessThan(300);
    expect(point.alpha).toBeLessThanOrEqual(MAX_ALPHA);
  });
  splash.age = splash.life + 0.01;
  expect(splashPoints(splash)).toEqual([]);
  expect(GRAVITY).toBeGreaterThan(0);
});
