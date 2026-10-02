import { hashString } from "../rng";
import { BURN_DOWN, CANDLE_X, DRIP_LENGTH, RING, adventLabel, candleBurn, daysLitFor, dripPath, ringFrontY, ringPoint, wreathLayout } from "./wreath";

// Der Kranz in der App (S6, W1, S11): aus dem Jahres-Seed - dieses Jahr immer gleich, nächstes Jahr anders; vier
// Kerzen, jede anders; Wachs und Docht wachsen mit den Tagen; der Text zum Kranz. Die festen Werte der Parität stehen
// genauso im Web (frontend/src/seasons/advent/wreath.test.js) - ändert jemand die Rechnung auf einer Seite, wird der
// Test der anderen rot.

const PARITY = {
  2026: { hash: 4223610512, length: 17632, candles: [[15.837920581456274, 1.8844192869961267, 1.35, -0.34, 1.07, 2.57, 0.84, -1, 0.81, "#f6ead2"], [13.49694399884902, 1.0402519737370315, 0.83, -0.14, 0.94, 2.49, 0.56, 1, 0.93, "#f3e4c8"], [13.883044199319556, 2.080886604916304, 1.77, -1.37, 1.17, 1.65, 0.75, 1, 0.81, "#f3e4c8"], [14.906982871936634, -0.16196427131071678, 1.11, -0.98, 1.15, 1.62, 0.93, 1, 1.37, "#f8eedb"]] },
  2027: { hash: 1998687380, length: 17647, candles: [[13.070400523254648, 0.0650886557996273, 1.13, -1.33, 1.07, 2.54, 0.95, 1, 1.39, "#f6ead2"], [13.68094030325301, 0.9735795404762029, 1.31, -1.75, 0.89, 2.48, 0.48, -1, 0.92, "#f6ead2"], [15.396932991920039, 0.3607307414524259, 0.96, -0.69, 0.97, 2.57, 0.59, 1, 0.83, "#f6ead2"], [14.694001608993858, -1.339164721593261, 1.7, -0.3, 1.15, 1.69, 0.92, -1, 1.04, "#f1e0c4"]] },
  salted: 2339257079,
};

test("derselbe Kranz wie im Web: dieselben Kerzen, dieselbe Prüfsumme je Jahr", () => {
  for (const year of [2026, 2027] as const) {
    const layout = wreathLayout(year);
    const text = JSON.stringify(layout);
    expect([hashString(text), text.length]).toEqual([PARITY[year].hash, PARITY[year].length]);
    expect(layout.candles.map((c) => [c.height, c.lean, c.flameDuration, c.flameDelay, c.flameAmp, c.glowDuration, c.wickGlow, c.dripSide, c.dripLength, c.tint])).toEqual(PARITY[year].candles);
  }
  expect(hashString(JSON.stringify(wreathLayout(2026, "geraet")))).toBe(PARITY.salted);
});

test("Kranz aus dem Jahres-Seed: gleich im Jahr, anders je Jahr und Salz; vier Kerzen, jede anders", () => {
  const a = wreathLayout(2026);
  expect(wreathLayout(2026)).toEqual(a);
  expect(JSON.stringify(wreathLayout(2027))).not.toBe(JSON.stringify(a));
  expect(JSON.stringify(wreathLayout(2026, "geraet"))).not.toBe(JSON.stringify(a));
  expect(a.candles).toHaveLength(4);
  expect(a.candles.map((c) => c.x)).toEqual(CANDLE_X);
  expect(new Set(a.candles.map((c) => c.flameDuration)).size).toBe(4);
  expect(new Set(a.candles.map((c) => `${c.height}:${c.lean}:${c.flameAmp}`)).size).toBe(4);
  a.candles.forEach((candle) => {
    expect(candle.height).toBeGreaterThanOrEqual(13);
    expect(candle.height).toBeLessThanOrEqual(16);
    expect(candle.flameDuration).toBeGreaterThan(0.8);
    expect(candle.flameDuration).toBeLessThan(1.8);
    expect(candle.flameDelay).toBeLessThanOrEqual(0);
    expect([-1, 1]).toContain(candle.dripSide);
    expect(candle.y).toBeGreaterThan(RING.cy);
  });
  expect(a.clusters.length).toBe(34);
  expect(a.clusters.every((c) => c.needles.length >= 4 && c.needles.length <= 5)).toBe(true);
  expect(a.clusters.some((c) => c.front)).toBe(true);
  expect(a.clusters.some((c) => !c.front)).toBe(true);
  expect(a.berries).toHaveLength(6);
  expect(a.bows).toHaveLength(2);
});

test("Ring: Punkte und vorderer Rand", () => {
  expect(ringPoint(0)).toEqual({ x: RING.cx + RING.rx, y: RING.cy });
  expect(ringPoint(90).y).toBeCloseTo(RING.cy + RING.ry, 5);
  expect(ringFrontY(RING.cx)).toBeCloseTo(RING.cy + RING.ry, 5);
  expect(ringFrontY(RING.cx + RING.rx)).toBeCloseTo(RING.cy, 5);
  expect(ringFrontY(15)).toBeLessThan(ringFrontY(30.5));
});

test("Wachs und Docht wachsen mit den Tagen, gedeckelt nach vier Wochen; Tage je Kerze nur für brennende", () => {
  const candle = { dripLength: 1 };
  expect(candleBurn(candle, 0)).toEqual({ burnDown: 0, drip: 0 });
  expect(candleBurn(candle, 7).burnDown).toBeCloseTo(BURN_DOWN / 4, 2);
  expect(candleBurn(candle, 21).drip).toBeCloseTo(DRIP_LENGTH, 2);
  expect(candleBurn(candle, 60)).toEqual({ burnDown: BURN_DOWN, drip: DRIP_LENGTH });
  expect(candleBurn({ dripLength: 0.5 }, 21).drip).toBeCloseTo(DRIP_LENGTH / 2, 2);
  expect(candleBurn(candle, null).burnDown).toBe(0);
  const sundays = ["2026-11-29", "2026-12-06", "2026-12-13", "2026-12-20"];
  expect(daysLitFor(sundays, 2, "2026-12-07")).toEqual([8, 1, null, null]);
  expect(daysLitFor(sundays, 4, "2026-12-24")).toEqual([25, 18, 11, 4]);
  expect(daysLitFor([], 2, "2026-12-07")).toEqual([]);
});

test("Text zum Kranz und Wachsspur", () => {
  expect(adventLabel({ candles: 2, daysToChristmas: 13 })).toBe("2. Advent – noch 13 Tage bis Weihnachten");
  expect(adventLabel({ candles: 4, daysToChristmas: 1 })).toBe("4. Advent – morgen ist Heiligabend");
  expect(adventLabel({ candles: 4, daysToChristmas: 0 })).toBe("Heiligabend – alle vier Kerzen brennen");
  expect(adventLabel({ candles: 0, daysToChristmas: 30 })).toBe("Bald ist Advent");
  expect(adventLabel({ candles: 3 })).toBe("3. Advent");
  expect(adventLabel({ candles: 9, daysToChristmas: 2 })).toBe("4. Advent – noch 2 Tage bis Weihnachten");
  expect(adventLabel()).toBe("Bald ist Advent");
  expect(dripPath(10, 20, 4, 1)).toMatch(/^M 10 20 c 1 1\.40/);
  expect(dripPath(10, 20, 4, -1)).toContain("c -1 1.40");
});
