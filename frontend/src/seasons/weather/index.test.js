import { WEATHER_KEY, describeWeather, weatherPlan, weatherShare } from "./index";

// Das Wetter auf der Seite (#673, Betreiber 29.09.): das ganze Jahr als Saison „Wetter“; in der Schnee-Saison regnet
// es nie - Regen wird zu Schnee; ohne die Saison, ohne frischen Stand und auf stillen Seiten nichts.

const weather = { key: WEATHER_KEY, effective: "normal" };
const halloween = { key: "halloween", effective: "normal" };
const snow = { key: "snow", effective: "normal" };
const RAIN = { rain_mm: 1.2, snow_cm: 0, wind_factor: 0.9, wind_dir: 270, night: false };
const SNOWFALL = { rain_mm: 0, snow_cm: 1.5, wind_factor: 0.6, wind_dir: 270, night: true };
const DRY = { rain_mm: 0, snow_cm: 0 };

test("Plan: das ganze Jahr Regen oder Schnee nach dem Wetter; die Schnee-Saison übernimmt; ausgeschaltet bleibt aus", () => {
  expect(weatherPlan({ seasons: [weather], weather: RAIN }).kind).toBe("rain");
  expect(weatherPlan({ seasons: [weather, halloween], weather: RAIN }).kind).toBe("rain");
  expect(weatherPlan({ seasons: [weather], weather: SNOWFALL }).kind).toBe("snow");
  expect(weatherPlan({ seasons: [weather], weather: { rain_mm: 1, snow_cm: 0.5 } }).kind).toBe("snow");
  expect(weatherPlan({ seasons: [weather], weather: DRY }).kind).toBe("none");
  expect(weatherPlan({ seasons: [weather, snow], weather: RAIN })).toMatchObject({ kind: "snow-season", rain: 1.2 });
  expect(weatherPlan({ seasons: [snow], weather: DRY }).kind).toBe("snow-season");
  expect(weatherPlan({ seasons: [halloween], weather: RAIN }).kind).toBe("off");
  expect(weatherPlan({ seasons: [], weather: RAIN }).kind).toBe("off");
  expect(weatherPlan({ seasons: [weather], weather: { ...RAIN, stale: true } }).kind).toBe("none");
  expect(weatherPlan({ seasons: [weather], weather: null }).kind).toBe("none");
  expect(weatherPlan().kind).toBe("off");
});

test("Seite: lebendige Seiten alles, ruhigere weniger, stille nichts", () => {
  expect(weatherShare("/")).toBe(1);
  expect(weatherShare("/events")).toBe(1);
  expect(weatherShare("/login")).toBe(0.6);
  expect(weatherShare("/tournaments/cup/bracket")).toBe(0.6);
  expect(weatherShare("/admin/x")).toBe(0);
});

test("In Worten für den Admin", () => {
  expect(describeWeather({ seasons: [weather], weather: RAIN })).toBe("Auf der Seite regnet es: leichter Regen (65 % der Tropfen).");
  expect(describeWeather({ seasons: [weather], weather: SNOWFALL })).toBe("Auf der Seite fällt leichter Schnee.");
  expect(describeWeather({ seasons: [weather], weather: DRY })).toBe("Kein Niederschlag – die Wetter-Ebene ruht.");
  expect(describeWeather({ seasons: [weather, snow], weather: RAIN })).toContain("aus dem Regen draußen wird Schnee");
  expect(describeWeather({ seasons: [snow], weather: SNOWFALL })).toContain("125 % der Flocken");
  expect(describeWeather({ seasons: [snow], weather: DRY })).toContain("55 % der Flocken");
  expect(describeWeather({ seasons: [halloween], weather: RAIN })).toBe("Das Wetter auf der Seite ist ausgeschaltet (Saison „Wetter“).");
  expect(describeWeather({ seasons: [weather], weather: { ...RAIN, stale: true } })).toContain("Kein frischer Wetterstand");
});
