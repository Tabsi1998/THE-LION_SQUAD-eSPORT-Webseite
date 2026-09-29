import { BURN_DOWN, CANDLE_X, DRIP_LENGTH, RING, adventLabel, candleBurn, daysLitFor, ringFrontY, ringPoint, wreathLayout } from "./wreath";

// Der Kranz (S6, W1): aus dem Jahres-Seed - dieses Jahr immer gleich, nächstes Jahr anders; vier Kerzen, jede anders;
// Wachs und Docht wachsen mit den Tagen; der Text zum Kranz.

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

test("Text zum Kranz", () => {
  expect(adventLabel({ candles: 2, daysToChristmas: 13 })).toBe("2. Advent – noch 13 Tage bis Weihnachten");
  expect(adventLabel({ candles: 4, daysToChristmas: 1 })).toBe("4. Advent – morgen ist Heiligabend");
  expect(adventLabel({ candles: 4, daysToChristmas: 0 })).toBe("Heiligabend – alle vier Kerzen brennen");
  expect(adventLabel({ candles: 0, daysToChristmas: 30 })).toBe("Bald ist Advent");
  expect(adventLabel({ candles: 3 })).toBe("3. Advent");
  expect(adventLabel({ candles: 9, daysToChristmas: 2 })).toBe("4. Advent – noch 2 Tage bis Weihnachten");
  expect(adventLabel()).toBe("Bald ist Advent");
});
