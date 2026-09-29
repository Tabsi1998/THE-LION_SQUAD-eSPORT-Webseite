// Das Wetter auf der Seite (#673, ergänzt vom Betreiber am 29.09.): das echte Wetter am Vereinsort zeigt sich das
// ganze Jahr - als eigene Saison „Wetter“, die im Admin wie jede andere an-, aus- und leiser gestellt werden kann.
// Die Regeln:
// - Schnee-Saison aktiv (1. Advent bis Dreikönig): es schneit immer und es regnet nie. Regen und Schnee draußen
//   machen den Schneefall dichter, je nach Menge (snow/flakes.js `snowfallFactor`).
// - Sonst: regnet es draußen, regnet es auf der Seite; schneit es draußen, fällt leichter Schnee.
// - Ohne Niederschlag ruht die Ebene und kostet nichts (der Zeichen-Loop schläft, sky.js).
// - „Bewegung reduzieren“ und „dezent“: nichts. Stille Seiten (Admin): nichts. Nachts etwas ruhiger.

import { effectClasses, pageClass } from "../intensity";
import { snowfallFactor } from "../snow/flakes";
import { rainFactor, rainLabel } from "./rain";

export const WEATHER_KEY = "weather";

/**
 * Was das Wetter auf der Seite tut: `snow-season` (die Schnee-Saison schneit, Regen wird zu Schnee), `off` (die
 * Saison „Wetter“ läuft nicht - ausgeschaltet oder keine Deko), `rain`, `snow` oder `none` (trocken, alter Stand).
 */
export function weatherPlan({ seasons = [], weather = null } = {}) {
  const rain = Math.max(0, Number(weather && weather.rain_mm) || 0);
  const snow = Math.max(0, Number(weather && weather.snow_cm) || 0);
  if (seasons.some((season) => season.key === "snow")) return { kind: "snow-season", rain, snow };
  if (!seasons.some((season) => season.key === WEATHER_KEY)) return { kind: "off", rain, snow };
  if (!weather || weather.stale) return { kind: "none", rain, snow };
  if (snow > 0) return { kind: "snow", rain, snow };
  if (rain > 0) return { kind: "rain", rain, snow };
  return { kind: "none", rain, snow };
}

/** Der Anteil der Seite: lebendige Seiten alles, ruhigere 60 %, stille nichts. */
export function weatherShare(pathname = "/") {
  const ambient = effectClasses(pageClass(pathname), "normal").ambient;
  return ambient === "near" ? 1 : ambient === "far" ? 0.6 : 0;
}

/** In Worten, was die Seite gerade aus dem Wetter macht - für die Wetterkarte im Admin. */
export function describeWeather({ seasons = [], weather = null } = {}) {
  const plan = weatherPlan({ seasons, weather });
  if (plan.kind === "snow-season") {
    const percent = Math.round(snowfallFactor(weather) * 100);
    if (plan.snow > 0) return `Schnee-Saison: es schneit draußen, auf der Seite schneit es dichter (${percent} % der Flocken).`;
    if (plan.rain > 0) return `Schnee-Saison: aus dem Regen draußen wird Schnee, auf der Seite schneit es dichter (${percent} % der Flocken).`;
    return "Schnee-Saison: kein Niederschlag draußen, auf der Seite schneit es leicht (55 % der Flocken).";
  }
  if (plan.kind === "off") return "Das Wetter auf der Seite ist ausgeschaltet.";
  if (weather && weather.stale) return "Kein frischer Wetterstand – die Wetter-Ebene ruht.";
  if (plan.kind === "rain") return `Auf der Seite regnet es: ${rainLabel(weather)} (${Math.round(rainFactor(weather) * 100)} % der Tropfen).`;
  if (plan.kind === "snow") return "Auf der Seite fällt leichter Schnee.";
  return "Kein Niederschlag – die Wetter-Ebene ruht.";
}

export { rainFactor, rainLabel } from "./rain";
