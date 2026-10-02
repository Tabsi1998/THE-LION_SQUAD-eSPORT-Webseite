import { mulberry32 } from "../rng";
import { pulseSteps } from "../sky/Lightning";
import { windAt } from "../snow/flakes";
import { shouldFlash, weatherPlan, weatherShare } from "./index";
import { MAX_ALPHA, RAIN_DEPTHS, SIDE_MARGIN, advanceDrop, createDrop, dropCounts, rainFactor, scrollDrop } from "./rain";
import { FLASH_GAP, FLASH_SECONDS, GLOW_ALPHA, createFlash, flashDone, flashLevel, isThunderstorm, nextFlashAt } from "./storm";

// Das Wetter in der App (#771): dieselben Regeln und dieselbe Rechnung wie im Web (`frontend/src/seasons/weather/`).
// In der Schnee-Saison regnet es nie; ohne die Saison „Wetter“, ohne frischen Stand und auf stillen Screens nichts.

const weather = { key: "weather" };
const snow = { key: "snow" };
const halloween = { key: "halloween" };
const RAIN = { rain_mm: 1.2, snow_cm: 0, wind_factor: 0.9, wind_dir: 270, night: false };
const SNOWFALL = { rain_mm: 0, snow_cm: 1.5, wind_factor: 0.6, wind_dir: 270, night: true };
const STORM = { rain_mm: 2.5, snow_cm: 0, code: 95, stale: false };

test("die fünf Fälle wie im Web: Schnee-Saison, Regen, Schnee, trocken, ausgeschaltet", () => {
  expect(weatherPlan({ seasons: [weather, snow], weather: RAIN }).kind).toBe("snow-season");
  expect(weatherPlan({ seasons: [weather, halloween], weather: RAIN }).kind).toBe("rain");
  expect(weatherPlan({ seasons: [weather], weather: SNOWFALL }).kind).toBe("snow");
  expect(weatherPlan({ seasons: [weather], weather: { rain_mm: 0, snow_cm: 0 } }).kind).toBe("none");
  expect(weatherPlan({ seasons: [weather], weather: { ...RAIN, stale: true } }).kind).toBe("none");
  expect(weatherPlan({ seasons: [halloween], weather: RAIN }).kind).toBe("off");
  expect(weatherPlan({ seasons: [], weather: null }).kind).toBe("off");
});

test("Anteil je Screen: lebendig alles, mittel und ruhig 60 %, still nichts", () => {
  expect(weatherShare("Dashboard")).toBe(1);
  expect(weatherShare("More")).toBe(0.6);
  expect(weatherShare("Profile")).toBe(0.6);
  expect(weatherShare("Settings")).toBe(0);
});

test("Wetterleuchten nur bei Gewitter mit frischem Stand - nie in der Schnee-Saison, nie ohne die Saison „Wetter“", () => {
  expect(isThunderstorm(STORM)).toBe(true);
  expect(isThunderstorm({ code: 96 })).toBe(true);
  expect(isThunderstorm({ code: 61 })).toBe(false);
  expect(isThunderstorm({ ...STORM, stale: true })).toBe(false);
  expect(shouldFlash(weatherPlan({ seasons: [weather], weather: STORM }), STORM)).toBe(true);
  expect(shouldFlash(weatherPlan({ seasons: [weather, snow], weather: STORM }), STORM)).toBe(false);
  expect(shouldFlash(weatherPlan({ seasons: [halloween], weather: STORM }), STORM)).toBe(false);
});

test("Regen: Menge nach rain_mm, drei Tiefen, nie deckender als 0,35, schräg mit dem Wind, unten wieder herein", () => {
  expect([0, 0.2, 1, 3, 6].map((rain_mm) => rainFactor({ rain_mm }))).toEqual([0, 0.35, 0.65, 1, 1.2]);
  expect(dropCounts(30, { share: 1, factor: 1 })).toEqual({ back: 18, mid: 12, front: 6, total: 36 });
  expect(dropCounts(30, { share: 1, factor: 1, night: true }).total).toBe(29);
  expect(dropCounts(30, { share: 0, factor: 1 }).total).toBe(0);
  const size = { width: 390, height: 844 };
  const rng = mulberry32(3);
  const drops = (["back", "mid", "front"] as const).map((depth) => createDrop(depth, size, rng, { anywhere: true }));
  drops.forEach((drop) => {
    expect(drop.alpha).toBeLessThanOrEqual(MAX_ALPHA);
    expect(drop.x).toBeGreaterThanOrEqual(-SIDE_MARGIN);
    expect(drop.length).toBeGreaterThanOrEqual(RAIN_DEPTHS[drop.depth].length[0]);
  });
  const drop = drops[2];
  const x = drop.x;
  advanceDrop(drop, 0.1, windAt(0, { factor: 1, sign: 1 }), size, () => 0.5);
  expect(drop.x).toBeGreaterThan(x);
  drop.y = size.height + drop.length + 1;
  advanceDrop(drop, 0.001, windAt(0), size, () => 0.5);
  expect(drop.y).toBeLessThan(0);
  drop.leaving = true;
  drop.y = size.height + drop.length + 1;
  advanceDrop(drop, 0.001, windAt(0), size, () => 0.5);
  expect(drop.done).toBe(true);
  const scrolled = scrollDrop({ ...drops[0], y: 100 }, 50, size, () => 0.5);
  expect(scrolled.y).toBeCloseTo(100 - 50 * RAIN_DEPTHS.back.scroll);
});

test("Blitz: frühestens nach acht Sekunden, ein oder zwei Pulse, nie heller als die Stärke, der Schein unter 14 %", () => {
  const rng = mulberry32(11);
  for (let n = 0; n < 20; n += 1) {
    const at = nextFlashAt(rng, 0);
    expect(at).toBeGreaterThanOrEqual(FLASH_GAP[0]);
    expect(at).toBeLessThanOrEqual(FLASH_GAP[1]);
  }
  expect(GLOW_ALPHA).toBeLessThanOrEqual(0.14);
  const flash = createFlash(mulberry32(5), { width: 390, height: 844 }, 10, 40);
  expect(flash.strength).toBeGreaterThanOrEqual(0.6);
  expect(flash.strength).toBeLessThanOrEqual(1);
  expect(flashLevel(flash, 9.9)).toBe(0);
  expect(flashLevel(flash, 10.04)).toBeCloseTo(flash.strength);
  expect(flashLevel(flash, 10 + FLASH_SECONDS + 0.01)).toBe(0);
  expect(flashDone(flash, 10 + FLASH_SECONDS + 0.01)).toBe(true);
  if (flash.bolt) expect(flash.bolt.main[0].y).toBe(40);
});

test("Pulse als Folge für Reanimated: dieselben Spitzen wie flashLevel", () => {
  expect(pulseSteps({ strength: 1, pulses: 1 }).map(([value, duration]) => [value, Math.round(duration)])).toEqual([[1, 40], [0, 200]]);
  const two = pulseSteps({ strength: 0.8, pulses: 2 });
  expect(two.map(([value]) => value)).toEqual([0.8, expect.any(Number), 0.8 * 0.6, 0]);
  // Zum Start des zweiten Pulses ist der erste auf 45 % gefallen - wie flashLevel es rechnet.
  expect(two[1][0]).toBeCloseTo(flashLevel({ startedAt: 0, pulses: 1, strength: 0.8 }, 0.15), 6);
  expect(two.reduce((sum, [, duration]) => sum + duration, 0)).toBeCloseTo(FLASH_SECONDS * 1000, 6);
});
