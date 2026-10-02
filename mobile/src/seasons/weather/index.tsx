import React from "react";
import { useWindowDimensions } from "react-native";
import { useAppActive } from "../halloween";
import { effectClasses, screenClass } from "../intensity";
import { seasonSeed, seasonYear } from "../rng";
import { useSeason, type ActiveSeason, type SeasonWeather } from "../SeasonProvider";
import { Lightning } from "../sky/Lightning";
import { RainField } from "../sky/RainField";
import { SnowField } from "../sky/SnowField";
import { seasonScroll } from "../sky/scroll";
import { skyBudget } from "../snow";
import { flakeCounts, snowfallFactor, windFrom } from "../snow/flakes";
import { dropCounts, rainFactor } from "./rain";
import { isThunderstorm } from "./storm";

// Das Wetter in der App (#771) - dieselben Regeln wie im Web (`frontend/src/seasons/weather/index.js`):
// - Schnee-Saison aktiv (1. Advent bis Dreikönig): es schneit immer und es regnet nie - das macht das Schnee-Modul.
// - Sonst: regnet es draußen, regnet es im Screen; schneit es draußen, fällt leichter Schnee.
// - Gewitter: Wetterleuchten, selten und leise - nie in der Schnee-Saison.
// - Ohne Niederschlag gibt es die Ebene gar nicht: kein Bild, kein Akku.
// - „Bewegung reduzieren“ und „dezent“: nichts. Ruhige und stille Screens: nichts. Nachts etwas ruhiger.

export const WEATHER_KEY = "weather";
/** Leichter Schnee außerhalb der Schnee-Saison: 60 % der Teilchen, wie im Web. */
export const LIGHT_SNOW_SHARE = 0.6;

export type WeatherPlan = { kind: "snow-season" | "off" | "rain" | "snow" | "none"; rain: number; snow: number };

/** Was das Wetter im Screen tut: `snow-season`, `off` (Saison „Wetter“ läuft nicht), `rain`, `snow` oder `none`. */
export function weatherPlan({ seasons = [], weather = null }: { seasons?: Array<Pick<ActiveSeason, "key">>; weather?: SeasonWeather | null }): WeatherPlan {
  const rain = Math.max(0, Number(weather && weather.rain_mm) || 0);
  const snow = Math.max(0, Number(weather && weather.snow_cm) || 0);
  if (seasons.some((season) => season.key === "snow")) return { kind: "snow-season", rain, snow };
  if (!seasons.some((season) => season.key === WEATHER_KEY)) return { kind: "off", rain, snow };
  if (!weather || weather.stale) return { kind: "none", rain, snow };
  if (snow > 0) return { kind: "snow", rain, snow };
  if (rain > 0) return { kind: "rain", rain, snow };
  return { kind: "none", rain, snow };
}

/** Der Anteil des Screens: lebendige Screens alles, ruhigere 60 %, stille nichts - wie `weatherShare` im Web. */
export function weatherShare(screen: string): number {
  const ambient = effectClasses(screenClass(screen), "normal").ambient;
  return ambient === "near" ? 1 : ambient === "far" ? 0.6 : 0;
}

/** Ob es im Screen wetterleuchtet: Gewitter gemeldet, die Saison „Wetter“ läuft, keine Schnee-Saison. */
export function shouldFlash(plan: WeatherPlan, weather: SeasonWeather | null | undefined): boolean {
  return plan.kind !== "snow-season" && plan.kind !== "off" && isThunderstorm(weather);
}

export function WeatherSky({ season, screen, reducedMotion }: { season: ActiveSeason; screen: string; reducedMotion: boolean }) {
  const { weather, seasons } = useSeason();
  const { width, height } = useWindowDimensions();
  const active = useAppActive();
  const budget = reducedMotion ? 0 : skyBudget(season.effective);
  const share = weatherShare(screen);
  if (!budget || share <= 0 || !width || !height) return null;
  const running = seasons.filter((item) => item.effective !== "off");
  const plan = weatherPlan({ seasons: running, weather });
  const flash = shouldFlash(plan, weather);
  if (plan.kind !== "rain" && plan.kind !== "snow" && !flash) return null;
  const size = { width, height };
  const year = seasonYear(season);
  const scroll = seasonScroll();
  const wind = windFrom(weather);
  return (
    <>
      {plan.kind === "rain" ? (
        <RainField
          capacity={dropCounts(budget, { factor: 1.2 })}
          counts={dropCounts(budget, { share, factor: rainFactor(weather), night: Boolean(weather?.night) })}
          wind={wind}
          size={size}
          seed={seasonSeed({ season: WEATHER_KEY, year, screen: "rain" })}
          running={active}
          scroll={scroll}
          testID="weather-rain"
        />
      ) : null}
      {plan.kind === "snow" ? (
        <SnowField
          capacity={flakeCounts(Math.round(budget * LIGHT_SNOW_SHARE), { factor: 1.25 })}
          counts={flakeCounts(Math.round(budget * LIGHT_SNOW_SHARE), { share, factor: snowfallFactor(weather, 0) })}
          wind={wind}
          size={size}
          seed={seasonSeed({ season: WEATHER_KEY, year, screen: "snow" })}
          running={active}
          scroll={scroll}
          testID="weather-snow"
        />
      ) : null}
      {flash ? <Lightning size={size} running={active} seed={seasonSeed({ season: WEATHER_KEY, year, screen: "storm" })} /> : null}
    </>
  );
}
