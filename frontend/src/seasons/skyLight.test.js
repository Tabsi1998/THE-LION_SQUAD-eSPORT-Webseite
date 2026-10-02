import { hashString } from "./rng";
import { GLOW_MS, SUN_SIDE, TWILIGHT_MS, cloudCover, nightAmount, skyLight, snowLightAt, winterStars } from "./skyLight";

// Licht am Winterhimmel (W4 #730): Tag, Dämmerung, Nacht weich nacheinander; Glühen auf der Seite der Sonne; Wolken
// dämpfen, bei Schnee und Nebel keine Sterne; Hauben tags weiß, nachts kühl, im Glühen warm, unter dem Mond heller.
// Die App rechnet dasselbe (mobile/src/seasons/sky/light.test.ts, gleicher Fingerabdruck).

const SKY_PARITY = 2188173118;

const SUNRISE = "2026-12-12T07:45:00+01:00";
const SUNSET = "2026-12-12T16:25:00+01:00";
const at = (time) => Date.parse(`2026-12-12T${time}+01:00`);
const light = (time, code = 0) => skyLight({ now: at(time), sunrise: SUNRISE, sunset: SUNSET, code });

test("Wolken aus dem Wettercode: klar, leicht, halb, bedeckt; Nebel, Regen und Schnee ganz zu; ohne Code etwas", () => {
  expect([0, 1, 2, 3, 45, 61, 71, 80, 85, 95].map(cloudCover)).toEqual([0, 0.15, 0.5, 0.9, 1, 1, 1, 0.85, 0.9, 1]);
  expect([null, undefined, "", "x"].map(cloudCover)).toEqual([0.35, 0.35, 0.35, 0.35]);
});

test("Nacht kommt weich: nach dem Untergang in der Dämmerung dunkel, vor dem Aufgang hell", () => {
  const rise = Date.parse(SUNRISE);
  const set = Date.parse(SUNSET);
  expect(nightAmount(at("12:00:00"), rise, set)).toBe(0);
  expect(nightAmount(set + TWILIGHT_MS / 2, rise, set)).toBeCloseTo(0.5, 5);
  expect(nightAmount(set + TWILIGHT_MS, rise, set)).toBe(1);
  expect(nightAmount(rise - TWILIGHT_MS / 2, rise, set)).toBeCloseTo(0.5, 5);
  expect(nightAmount(at("03:00:00"), rise, set)).toBe(1);
});

test("Mittag: kein Blau, kein Glühen, keine Sterne; der Mond nur blass", () => {
  expect(light("12:00:00")).toEqual({ night: 0, warmth: 0, side: SUN_SIDE.dusk, clouds: 0, stars: 0, moon: 0.25 });
});

test("Abends glüht es rechts (Südwesten), morgens links (Südosten); Wolken dämpfen das Glühen", () => {
  const dusk = light("16:30:00");
  expect(dusk.warmth).toBeGreaterThan(0.9);
  expect(dusk.side).toBe(SUN_SIDE.dusk);
  expect(dusk.night).toBeGreaterThan(0);
  const dawn = light("07:40:00");
  expect(dawn.warmth).toBeGreaterThan(0.9);
  expect(dawn.side).toBe(SUN_SIDE.dawn);
  expect(light("16:30:00", 3).warmth).toBeLessThan(dusk.warmth * 0.5);
  expect(skyLight({ now: Date.parse(SUNSET) + GLOW_MS + 60000, sunrise: SUNRISE, sunset: SUNSET, code: 0 }).warmth).toBe(0);
});

test("Nacht: klar alle Sterne und deutlicher Mond; bedeckt kaum, bei Schnee keine Sterne", () => {
  expect(light("21:00:00")).toMatchObject({ night: 1, warmth: 0, stars: 1, moon: 1 });
  expect(light("21:00:00", 2).stars).toBeCloseTo(0.354, 3);
  expect(light("21:00:00", 71)).toMatchObject({ stars: 0, moon: 0.15 });
});

test("Ohne Sonnenzeiten: die Nacht der Saison (ja/nein)", () => {
  expect(skyLight({ now: at("21:00:00"), night: true, code: 0 })).toMatchObject({ night: 1, warmth: 0, stars: 1 });
  expect(skyLight({ now: at("21:00:00"), night: false, code: 0 })).toMatchObject({ night: 0, stars: 0 });
});

test("Hauben: tags die Farben von früher, nachts kühl, im Glühen auf der Sonnenseite warm, unter dem Mond heller", () => {
  expect(snowLightAt(light("12:00:00"), 0.5)).toEqual({ top: "#ffffff", mid: "#e6eff8", bottom: "#c7d8ea" });
  const night = snowLightAt(light("21:00:00"), 0.5);
  expect(night.top).toBe("#d6e2ff");
  const warmRight = snowLightAt(light("16:30:00"), 0.75);
  const warmLeft = snowLightAt(light("16:30:00"), 0.05);
  const red = (color) => parseInt(color.slice(1, 3), 16);
  const blue = (color) => parseInt(color.slice(5, 7), 16);
  expect(red(warmRight.mid) - blue(warmRight.mid)).toBeGreaterThan(red(warmLeft.mid) - blue(warmLeft.mid));
  const underMoon = snowLightAt(light("21:00:00"), 0.4, 0.4);
  expect(red(underMoon.top)).toBeGreaterThan(red(night.top));
});

test("Sterne: je Jahr anders, im Jahr gleich, im oberen Teil des Fensters", () => {
  const stars = winterStars(2026, 32);
  expect(stars).toHaveLength(32);
  expect(winterStars(2026, 32)).toEqual(stars);
  expect(winterStars(2027, 32)).not.toEqual(stars);
  stars.forEach((star) => {
    expect(star.y).toBeLessThanOrEqual(0.52);
    expect(star.x).toBeGreaterThanOrEqual(0.02);
    expect(star.x).toBeLessThanOrEqual(0.98);
  });
});

test("Parität mit der App: derselbe Fingerabdruck für Licht, Hauben und Sterne", () => {
  const times = ["03:00:00", "07:20:00", "07:40:00", "08:10:00", "12:00:00", "16:10:00", "16:30:00", "16:50:00", "17:20:00", "21:00:00"];
  const sample = {
    light: times.flatMap((time) => [0, 2, 3, 71, null].map((code) => light(time, code))),
    snow: times.map((time) => [0.05, 0.3, 0.5, 0.75, 0.95].map((x) => snowLightAt(light(time), x, 0.4))),
    stars: [winterStars(2026, 32), winterStars(2027, 8)],
  };
  expect(hashString(JSON.stringify(sample))).toBe(SKY_PARITY);
});
