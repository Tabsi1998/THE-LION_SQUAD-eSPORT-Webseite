import { hashString, mulberry32 } from "../rng";
import { DEPTHS, DEPTH_ORDER, advanceFlake, createFlake, fadeAt, flakeCounts, gustAt, nextGust, scrollFlake, snowfallFactor, windAt, windFrom, type Flake } from "./flakes";

// Schnee in der App (#642, #771): dieselbe Rechnung wie im Web. Der Paritätstest steht mit denselben festen Werten
// auch in `frontend/src/seasons/snow/flakes.test.js` - weicht eine Seite ab, wird die andere rot.

const SIZE = { width: 390, height: 844 };

/** Ein Fingerabdruck der Rechnung: Flocken aus festem Seed, ein Böenplan, Wind, zwanzig Schritte und ein Scroll. */
function parityPrint(): number {
  const rng = mulberry32(hashString("snow:parity"));
  const flakes: Flake[] = [];
  DEPTH_ORDER.forEach((depth) => {
    for (let index = 0; index < 12; index += 1) flakes.push(createFlake(depth, SIZE, rng, { index, anywhere: index % 2 === 0 }));
  });
  const gust = nextGust(rng, 3);
  const base = windFrom({ wind_factor: 0.9, wind_dir: 250 });
  const fixed = mulberry32(7);
  for (let step = 0; step < 20; step += 1) {
    const t = 3 + step * 0.05 + gust.at - 3;
    const wind = windAt(t, base, gust);
    flakes.forEach((flake) => advanceFlake(flake, 0.05, wind, SIZE, fixed));
  }
  flakes.forEach((flake) => scrollFlake(flake, 120, SIZE, fixed));
  const round = (value: number) => Math.round(value * 1000);
  return hashString(JSON.stringify(flakes.map((flake) => [flake.shape, round(flake.x), round(flake.y), round(flake.radius), round(flake.fall), round(flake.rotation), round(flake.opacity), flake.spiral ? 1 : 0])));
}

test("Parität mit dem Web: derselbe Fingerabdruck aus Flocken, Böen, Wind, Schritten und Scrollen", () => {
  expect(parityPrint()).toBe(PARITY);
});

test("drei Tiefen wie im Web: hinten weich und ohne Drehung, vorne groß und langsam", () => {
  expect(DEPTH_ORDER).toEqual(["back", "mid", "front"]);
  expect(DEPTHS.back.soft).toBe(true);
  expect(DEPTHS.back.spin).toBe(0);
  expect(DEPTHS.front.size[0]).toBeGreaterThan(DEPTHS.mid.size[1]);
  expect(DEPTHS.front.fall[1]).toBeLessThan(DEPTHS.back.fall[0]);
  expect(DEPTHS.back.share + DEPTHS.mid.share + DEPTHS.front.share).toBeCloseTo(1, 6);
});

test("Wind aus dem Wetter: Stärke begrenzt, Richtung aus dem Kompass, Böen mit Anstieg, Plateau und Abklingen", () => {
  expect(windFrom(null)).toEqual({ factor: 0.6, sign: 1 });
  expect(windFrom({ wind_factor: 5, wind_dir: 270 })).toEqual({ factor: 1.6, sign: 1 });
  expect(windFrom({ wind_factor: 0.1, wind_dir: 90 })).toEqual({ factor: 0.3, sign: -1 });
  const gust = { at: 10, length: 4, strength: 2 };
  expect(gustAt(gust, 9)).toBe(1);
  expect(gustAt(gust, 10.5)).toBeCloseTo(1.5);
  expect(gustAt(gust, 13)).toBe(2);
  expect(gustAt(gust, 16)).toBeCloseTo(1.5);
  expect(gustAt(gust, 20)).toBe(1);
  expect(windAt(0, { factor: 1, sign: -1 }).x).toBeLessThan(0);
});

test("Mengen: 55 % ohne Niederschlag, dichter mit Schnee oder Regen, Ausklang in den letzten zehn Minuten", () => {
  expect(snowfallFactor(null)).toBe(0.55);
  expect(snowfallFactor({ snow_cm: 0.1 })).toBe(0.8);
  expect(snowfallFactor({ rain_mm: 1 })).toBe(1);
  expect(snowfallFactor({ snow_cm: 2 })).toBe(1.25);
  expect(snowfallFactor({}, 0)).toBe(0);
  expect(flakeCounts(30, { share: 1, factor: 1 })).toEqual({ back: 15, mid: 10, front: 5, total: 30 });
  expect(flakeCounts(30, { share: 0.6, factor: 0.55 }).total).toBe(10);
  expect(flakeCounts(30, { share: 0 }).total).toBe(0);
  const end = Date.parse("2027-01-06T23:59:59+01:00");
  expect(fadeAt("2027-01-06T23:59:59+01:00", end - 20 * 60 * 1000)).toBe(1);
  expect(fadeAt("2027-01-06T23:59:59+01:00", end - 5 * 60 * 1000)).toBeCloseTo(0.5);
  expect(fadeAt("2027-01-06T23:59:59+01:00", end + 1)).toBe(0);
});

test("eine Flocke fällt, treibt mit dem Wind und kommt oben wieder herein - außer sie verlässt das Feld", () => {
  const rng = mulberry32(1);
  const flake = createFlake("front", SIZE, rng, { index: 0 });
  flake.y = SIZE.height + 100;
  advanceFlake(flake, 0.016, windAt(0), SIZE, () => 0.5);
  expect(flake.y).toBeLessThan(0);
  expect(flake.x).toBeCloseTo(195);
  flake.leaving = true;
  flake.y = SIZE.height + 100;
  advanceFlake(flake, 0.016, windAt(0), SIZE, () => 0.5);
  expect(flake.done).toBe(true);
});

const PARITY = 1298028011;
