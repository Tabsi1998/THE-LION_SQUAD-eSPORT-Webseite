import { hashString } from "../rng";
import { PLATE, TOP, cakePlan, ignitionOrder } from "./cake";
import { GARLAND_PAD, PENNANT_COLORS, garlandPlan, garlandSpan, pennants, probePoints, stringY } from "./garland";

// Torte (B1 #749, #856) und Girlanden (B2 #750): die Jahre als Zahlkerzen, keine hart codierten
// Jahre, je Jahr etwas anders und innerhalb des Jahres gleich; die App rechnet dieselbe Torte (gleicher Fingerabdruck in
// mobile/src/seasons/birthday/cake.test.ts). Die Wimpel hängen am Faden, je Seite und Jahr anders.

const CAKE_PARITY = 1925493762;

test("die Jahre als Zahlkerzen (#856): eine Ziffer je Kerze; ohne Jahre eine „1“", () => {
  for (const [years, text] of [[1, "1"], [7, "7"], [12, "12"], [13, "13"], [105, "105"]]) {
    const plan = cakePlan(years, 2027);
    expect(plan.numbers).toBe(true);
    expect(plan.candles).toEqual([]);
    expect(plan.digits.map((candle) => candle.digit).join("")).toBe(text);
  }
  expect(cakePlan(null, 2027).digits.map((candle) => candle.digit).join("")).toBe("1");
  expect(cakePlan(0, 2027).digits.map((candle) => candle.digit).join("")).toBe("1");
});

test("Zahlkerzen stehen mittig auf dem oberen Stock; Streusel lassen die Zuckerplatte frei", () => {
  const plan = cakePlan(18, 2028);
  plan.digits.forEach((candle) => {
    expect(Math.abs(candle.x - TOP.cx)).toBeLessThanOrEqual(TOP.rx);
    expect(Math.abs(candle.base - TOP.y)).toBeLessThanOrEqual(TOP.ry);
  });
  const middle = plan.digits.reduce((sum, candle) => sum + candle.x, 0) / plan.digits.length;
  expect(Math.abs(middle - TOP.cx)).toBeLessThan(0.01);
  plan.sprinkles.forEach((dot) => expect(Math.hypot(dot.x - PLATE.cx, dot.y - PLATE.cy)).toBeGreaterThan(PLATE.r));
});

test("je Jahr etwas anders, innerhalb des Jahres gleich - und dieselbe Torte wie in der App", () => {
  expect(cakePlan(8, 2027)).toEqual(cakePlan(8, 2027));
  expect(cakePlan(8, 2027).topDrips).not.toBe(cakePlan(8, 2028).topDrips);
  expect(hashString(JSON.stringify(cakePlan(8, 2027)))).toBe(CAKE_PARITY);
});

test("angezündet wird von links nach rechts, im festen Abstand", () => {
  const order = ignitionOrder(cakePlan(105, 2027), 200);
  expect(order.map((step) => step.at)).toEqual([0, 200, 400]);
  const plan = cakePlan(105, 2027);
  const xs = order.map((step) => plan.digits.find((candle) => candle.index === step.index).x);
  expect(xs).toEqual([...xs].sort((a, b) => a - b));
});

test("Girlanden: je Seite eine, fest je Jahr und Seite, sieben bis zehn Wimpel in Vereinsfarben", () => {
  const plan = garlandPlan(2027, "/");
  expect(garlandPlan(2027, "/")).toEqual(plan);
  expect(garlandPlan(2027, "/events")).not.toEqual(plan);
  expect(plan.map((chain) => chain.side)).toEqual(["left", "right"]);
  plan.forEach((chain) => {
    expect(chain.count).toBeGreaterThanOrEqual(7);
    expect(chain.count).toBeLessThanOrEqual(10);
  });
  const list = pennants(plan[0], 10, 210, 80, 30);
  expect(list).toHaveLength(plan[0].count);
  list.forEach((pennant) => {
    expect(pennant.y).toBeCloseTo(stringY(10, 210, 80, 30, pennant.x), 0);
    expect(PENNANT_COLORS).toContain(pennant.color);
  });
  // Links fällt der Faden ab, rechts steigt er: die Wimpel neigen sich mit.
  expect(list[0].angle).toBeGreaterThan(0);
  expect(list[list.length - 1].angle).toBeLessThan(0);
});

test("Girlanden hängen in den Ecken - auf breiten Schirmen im Rand neben dem Inhalt; die Probe deckt den ganzen Kasten", () => {
  const [left, right] = garlandPlan(2027, "/");
  const narrowLeft = garlandSpan(left, 390, { left: 0, right: 390 });
  expect(narrowLeft.x0).toBe(GARLAND_PAD + 2);
  expect(narrowLeft.x1).toBeLessThan(390 / 2);
  const narrowRight = garlandSpan(right, 390, null);
  expect(narrowRight.x1).toBe(390 - GARLAND_PAD - 2);
  const wideLeft = garlandSpan(left, 2560, { left: 640, right: 1920 });
  expect(wideLeft.x1).toBe(628);
  expect(wideLeft.x1 - wideLeft.x0).toBeLessThanOrEqual(260);
  const wideRight = garlandSpan(right, 2560, { left: 640, right: 1920 });
  expect(wideRight.x0).toBe(1932);
  const points = probePoints(left, 10, 200, 80, 30);
  expect(points.some((point) => point.x < 10 && point.y === 80 + 30 + left.size + GARLAND_PAD)).toBe(true);
  expect(points.some((point) => point.x > 200)).toBe(true);
});
