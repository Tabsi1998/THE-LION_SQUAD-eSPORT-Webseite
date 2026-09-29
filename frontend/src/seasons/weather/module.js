// Die Saison „Wetter“ (#673, Betreiber 29.09.): läuft das ganze Jahr, solange sie im Admin eingeschaltet ist, und
// gibt der Bühne genau eine Ebene - Regen oder leichten Schnee aus dem echten Wetter am Vereinsort. In der
// Schnee-Saison ruht sie (dort wird Regen zu Schnee); ohne Niederschlag ruht sie auch, und mit ihr der Zeichen-Loop.
// Keine Ecken, kein Widget, kein Farbschein: das Wetter ist nur Himmel (`skyOnly`).

import { seasonSeed, seasonYear } from "../rng";
import { createWeatherLayer } from "./layer";
import { weatherShare } from "./index";

/**
 * Die Ebene für den gemeinsamen Canvas-Loop - nicht ohne Bewegung, nicht bei „dezent“, nicht auf stillen Seiten.
 * In der Vorschau aus dem Admin regnet es auch dort: wer auf „Vorschau“ drückt, soll sofort etwas sehen.
 */
export function skyLayers({ season, budget = 0, reducedMotion = false, weather = null, preview = false }) {
  if (reducedMotion || !season || season.effective === "subtle" || !budget) return [];
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const share = preview ? 1 : weatherShare(pathname);
  if (share <= 0) return [];
  return [createWeatherLayer({ budget, share, seed: seasonSeed({ season: "weather", year: seasonYear("weather"), route: pathname }), weather })];
}

export const season = { key: "weather", skyLayers, skyOnly: true };
