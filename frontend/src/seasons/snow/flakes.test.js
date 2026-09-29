import { DEPTHS, DEPTH_ORDER, FAST_EVERY, GUST, SHAPES, advanceFlake, createFlake, fadeAt, flakeCounts, gustAt, nextGust, scrollFlake, snowfallFactor, windAt, windFrom } from "./flakes";
import { mulberry32 } from "../rng";

// Schneefall (S7, W2): drei Tiefen mit klar verschiedenen Größen und Tempi, keine zwei Flocken gleich, Wind aus
// dem Wetter mit einheitlicher Richtung, Böen mit weichem Anstieg und Abklingen, Zahl aus Budget, Seite, Wetter
// und Ausklang.

const SIZE = { width: 1200, height: 800 };

test("Wind aus dem Wetter: Stärke geklemmt, Richtung aus der Windrichtung (aus Westen → nach rechts), Vorgabe 0,6", () => {
  expect(windFrom(null)).toEqual({ factor: 0.6, sign: 1 });
  expect(windFrom({ wind_factor: 9, wind_dir: 270 })).toEqual({ factor: 1.6, sign: 1 });
  expect(windFrom({ wind_factor: 0.1, wind_dir: 90 })).toEqual({ factor: 0.3, sign: -1 });
  expect(windFrom({ wind_factor: 0.8, wind_dir: 0 }).sign).toBe(1);
  expect(windFrom({ wind_factor: 0.8, wind_dir: 180 }).sign).toBe(1);
  expect(windFrom({ wind_factor: 0.8, wind_dir: 45 }).sign).toBe(-1);
  const calm = windAt(3, { factor: 0.3, sign: 1 });
  const strong = windAt(3, { factor: 1.6, sign: 1 });
  expect(strong.x).toBeGreaterThan(calm.x);
  expect(strong.y).toBeGreaterThan(calm.y);
  expect(windAt(3, { factor: 0.6, sign: -1 }).x).toBeLessThan(0);
  expect(windAt(3, { factor: 0.6, sign: -1 }).y).toBeGreaterThan(0);
});

test("Böen: kommen alle 20–40 s, steigen weich an, halten, klingen ab - alle Ebenen spüren dieselbe", () => {
  const gust = nextGust(mulberry32(3), 100);
  expect(gust.at).toBeGreaterThanOrEqual(120);
  expect(gust.at).toBeLessThanOrEqual(140);
  expect(gust.length).toBeGreaterThanOrEqual(GUST.length[0]);
  expect(gust.strength).toBeGreaterThanOrEqual(GUST.strength[0]);
  expect(gustAt(gust, gust.at - 1)).toBe(1);
  expect(gustAt(gust, gust.at + GUST.attack / 2)).toBeCloseTo(1 + (gust.strength - 1) / 2, 5);
  expect(gustAt(gust, gust.at + GUST.attack + 1)).toBe(gust.strength);
  const release = gustAt(gust, gust.at + GUST.attack + gust.length + GUST.release / 2);
  expect(release).toBeGreaterThan(1);
  expect(release).toBeLessThan(gust.strength);
  expect(gustAt(gust, gust.at + GUST.attack + gust.length + GUST.release + 1)).toBe(1);
  expect(gustAt(null, 5)).toBe(1);
  const before = windAt(gust.at - 1, { factor: 0.6, sign: 1 }, gust);
  const during = windAt(gust.at + GUST.attack + 1, { factor: 0.6, sign: 1 }, gust);
  expect(during.x / before.x).toBeGreaterThan(1.3);
  // Vorne mehr als hinten: derselbe Wind, andere Anteile.
  expect(DEPTHS.front.wind).toBeGreaterThan(DEPTHS.mid.wind);
  expect(DEPTHS.mid.wind).toBeGreaterThan(DEPTHS.back.wind);
});

test("drei Tiefen: hinten klein und schnell, vorne groß und langsam; Formen, Phasen und Tempi verschieden; jede zwölfte vorne ein Ausreißer", () => {
  const rng = mulberry32(11);
  const back = Array.from({ length: 40 }, (_, i) => createFlake("back", SIZE, rng, { index: i }));
  const front = Array.from({ length: 40 }, (_, i) => createFlake("front", SIZE, rng, { index: i }));
  const avg = (items, key) => items.reduce((sum, item) => sum + item[key], 0) / items.length;
  expect(avg(back, "radius")).toBeLessThan(avg(front, "radius"));
  expect(avg(back.filter((f) => !f.fast), "fall")).toBeGreaterThan(avg(front.filter((f) => !f.fast), "fall"));
  expect(back.every((f) => f.shape === "dot")).toBe(true);
  expect(new Set(front.map((f) => f.shape)).size).toBeGreaterThan(2);
  front.forEach((f) => expect(SHAPES).toContain(f.shape));
  expect(new Set(front.map((f) => f.phase.toFixed(4))).size).toBe(40);
  expect(new Set(front.map((f) => `${f.fall.toFixed(3)}:${f.swayFreq.toFixed(3)}`)).size).toBe(40);
  expect(front.filter((f) => f.fast).length).toBe(Math.floor(40 / FAST_EVERY));
  expect(back.filter((f) => f.fast).length).toBe(0);
  const fast = front.find((f) => f.fast);
  expect(fast.fall).toBeGreaterThan(DEPTHS.front.fall[1]);
  expect(front.some((f) => f.spiral)).toBe(true);
  expect(front.every((f) => f.y < 0)).toBe(true);
  expect(createFlake("mid", SIZE, rng, { anywhere: true }).y).toBeGreaterThanOrEqual(0);
  expect(DEPTH_ORDER).toEqual(["back", "mid", "front"]);
});

test("Schritt: fällt, schwingt, driftet mit dem Wind, taumelt; unten und seitlich kommt sie wieder herein", () => {
  const flake = createFlake("front", SIZE, mulberry32(5), { index: 0 });
  flake.y = 100;
  flake.x = 600;
  flake.spin = 1;
  const wind = { x: 40, y: 6, strength: 1 };
  const before = { ...flake };
  advanceFlake(flake, 0.5, wind, SIZE);
  expect(flake.y).toBeGreaterThan(before.y);
  expect(flake.rotation).not.toBe(before.rotation);
  expect(Math.abs(flake.x - before.x)).toBeLessThan(60);
  // Ohne Schwingen bleibt die Drift reiner Wind (mal Anteil der Ebene).
  const calm = { ...flake, swayAmp: 0, spiral: false, x: 600, y: 100, age: 0 };
  advanceFlake(calm, 1, wind, SIZE);
  expect(calm.x).toBeCloseTo(600 + 40 * DEPTHS.front.wind, 5);
  const gone = { ...flake, y: SIZE.height + 100 };
  advanceFlake(gone, 0.016, wind, SIZE);
  expect(gone.y).toBeLessThan(0);
  const left = { ...flake, x: -200, swayAmp: 0, spiral: false };
  advanceFlake(left, 0.016, { x: -1, y: 0, strength: 0 }, SIZE);
  expect(left.x).toBeGreaterThan(SIZE.width);
});

test("Zahl der Flocken: Budget mal Seite mal Wetter mal Ausklang, Anteile je Tiefe", () => {
  expect(flakeCounts(240, { snowing: true })).toEqual({ back: 120, mid: 77, front: 43, total: 240 });
  expect(flakeCounts(240, { snowing: false }).total).toBe(132);
  expect(flakeCounts(240, { snowing: true, share: 0.5 }).total).toBe(120);
  expect(flakeCounts(240, { snowing: true, fade: 0.25 }).total).toBe(60);
  expect(flakeCounts(0, { snowing: true }).total).toBe(0);
  expect(flakeCounts(40, { snowing: true, share: 0 }).total).toBe(0);
  const now = Date.parse("2027-01-06T23:55:00+01:00");
  expect(fadeAt("2027-01-06T23:59:59+01:00", now)).toBeCloseTo(0.4998, 2);
  expect(fadeAt("2027-01-06T23:59:59+01:00", now - 60 * 60 * 1000)).toBe(1);
  expect(fadeAt("2027-01-06T23:59:59+01:00", now + 60 * 60 * 1000)).toBe(0);
  expect(fadeAt("", now)).toBe(1);
});

test("Scrollen: die Flocken gehören zur Seite - vorne ganz, hinten weniger; was hinausgeschoben wird, kommt an neuer Stelle wieder herein", () => {
  const front = { depth: "front", radius: 5, x: 300, y: 400 };
  const back = { depth: "back", radius: 2, x: 300, y: 400 };
  scrollFlake(front, 100, SIZE);
  scrollFlake(back, 100, SIZE);
  expect(front).toMatchObject({ x: 300, y: 300 });
  expect(back.y).toBeCloseTo(400 - 100 * DEPTHS.back.scroll, 5);
  expect(back.x).toBe(300);
  expect(DEPTHS.front.scroll).toBe(1);
  expect(DEPTHS.mid.scroll).toBeLessThan(DEPTHS.front.scroll);
  expect(DEPTHS.back.scroll).toBeLessThan(DEPTHS.mid.scroll);
  // Nach oben scrollen schiebt sie nach unten.
  scrollFlake(front, -50, SIZE);
  expect(front.y).toBe(350);
  // Kein Scrollen: nichts ändert sich.
  expect(scrollFlake({ ...front }, 0, SIZE)).toMatchObject({ x: 300, y: 350 });
  // Oben hinaus: unten wieder herein, an einer neuen Stelle.
  const margin = 5 * 3 + 10;
  const top = { depth: "front", radius: 5, x: 300, y: 10 };
  scrollFlake(top, 100, SIZE, () => 0.25);
  expect(top.y).toBeCloseTo(10 - 100 + SIZE.height + margin * 2, 5);
  expect(top.x).toBe(SIZE.width * 0.25);
  // Ein Sprung über viele Fensterhöhen bleibt im Bild - in beide Richtungen.
  [7321, -9105, 50000].forEach((jump) => {
    const flake = { depth: "front", radius: 5, x: 300, y: 200 };
    scrollFlake(flake, jump, SIZE, () => 0.5);
    expect(flake.y).toBeGreaterThanOrEqual(-margin);
    expect(flake.y).toBeLessThan(SIZE.height + margin);
  });
});

test("Dichte nach dem Wetter: ohne Niederschlag 55 %, Schnee und - im Winter wird Regen zu Schnee - Regen machen es dichter", () => {
  expect(snowfallFactor(null)).toBe(0.55);
  expect(snowfallFactor({ snow_cm: 0, rain_mm: 0 })).toBe(0.55);
  expect(snowfallFactor({ snow_cm: 0.1 })).toBe(0.8);
  expect(snowfallFactor({ rain_mm: 0.2 })).toBe(0.8);
  expect(snowfallFactor({ snow_cm: 1 })).toBe(1);
  expect(snowfallFactor({ rain_mm: 1.2 })).toBe(1);
  expect(snowfallFactor({ snow_cm: 0.8, rain_mm: 0.9 })).toBe(1.25);
  expect(snowfallFactor({ rain_mm: 6 })).toBe(1.25);
  expect(snowfallFactor({ snow_cm: -3, rain_mm: "x" })).toBe(0.55);
  expect(flakeCounts(240, { factor: 1.25 }).total).toBe(300);
  expect(flakeCounts(240, { factor: 0.8, share: 0.5 }).total).toBe(96);
  expect(flakeCounts(240, { factor: 0.55 }).total).toBe(flakeCounts(240, { snowing: false }).total);
  expect(flakeCounts(240, { factor: 1 }).total).toBe(flakeCounts(240, { snowing: true }).total);
});
