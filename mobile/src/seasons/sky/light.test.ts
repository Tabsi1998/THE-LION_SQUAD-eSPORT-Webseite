import { hashString } from "../rng";
import { SUN_SIDE, cloudCover, skyLight, snowLightAt, winterStars } from "./light";

// Licht am Winterhimmel in der App (W4 #730): dieselbe Rechnung wie im Web - der Fingerabdruck ist derselbe wie in
// frontend/src/seasons/skyLight.test.js.

const SKY_PARITY = 2188173118;
const SUNRISE = "2026-12-12T07:45:00+01:00";
const SUNSET = "2026-12-12T16:25:00+01:00";
const at = (time: string) => Date.parse(`2026-12-12T${time}+01:00`);
const light = (time: string, code: number | null = 0) => skyLight({ now: at(time), sunrise: SUNRISE, sunset: SUNSET, code });

test("Tag, Glühen, Nacht wie im Web; Wolken aus dem Wettercode", () => {
  expect([0, 1, 2, 3, 45, 71, null].map(cloudCover)).toEqual([0, 0.15, 0.5, 0.9, 1, 1, 0.35]);
  expect(light("12:00:00")).toEqual({ night: 0, warmth: 0, side: SUN_SIDE.dusk, clouds: 0, stars: 0, moon: 0.25 });
  expect(light("16:30:00").warmth).toBeGreaterThan(0.9);
  expect(light("07:40:00").side).toBe(SUN_SIDE.dawn);
  expect(light("21:00:00")).toMatchObject({ night: 1, stars: 1, moon: 1 });
  expect(light("21:00:00", 71).stars).toBe(0);
  expect(skyLight({ now: at("21:00:00"), night: true, code: 0 }).night).toBe(1);
});

test("Parität mit dem Web: derselbe Fingerabdruck für Licht, Schneefarben und Sterne", () => {
  const times = ["03:00:00", "07:20:00", "07:40:00", "08:10:00", "12:00:00", "16:10:00", "16:30:00", "16:50:00", "17:20:00", "21:00:00"];
  const sample = {
    light: times.flatMap((time) => [0, 2, 3, 71, null].map((code) => light(time, code))),
    snow: times.map((time) => [0.05, 0.3, 0.5, 0.75, 0.95].map((x) => snowLightAt(light(time), x, 0.4))),
    stars: [winterStars(2026, 32), winterStars(2027, 8)],
  };
  expect(hashString(JSON.stringify(sample))).toBe(SKY_PARITY);
});
