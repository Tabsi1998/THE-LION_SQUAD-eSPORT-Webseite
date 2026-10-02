import { seasonRng } from "../rng";

// Licht am Winterhimmel in der App (W4 #730, #772) - dieselbe Rechnung wie `frontend/src/seasons/skyLight.js`
// (Paritätstest mit gleichem Fingerabdruck): wie dunkel, warm oder kühl der Himmel gerade ist, aus Sonnenauf- und
// -untergang am Vereinsort (Server) und dem Wettercode. Die Nacht kommt weich, um Auf- und Untergang glüht es auf der
// Seite der Sonne (abends rechts, morgens links), Wolken dämpfen Glühen, Sterne und Mond; bei Schnee keine Sterne.

export const TWILIGHT_MS = 45 * 60000;
export const GLOW_MS = 40 * 60000;
/** Wo die Sonne im Winter auf- und untergeht, als Anteil der Breite (Azimut ~125° und ~235°). */
export const SUN_SIDE = { dawn: 0.3, dusk: 0.7 };

export type SkyLight = { night: number; warmth: number; side: number; clouds: number; stars: number; moon: number };
export type SnowTone = { top: string; mid: string; bottom: string };
export type WinterStar = { index: number; x: number; y: number; r: number; bright: number; phase: number };

type Rgb = [number, number, number];
const SNOW: Record<"day" | "night" | "warm", Record<"top" | "mid" | "bottom", Rgb>> = {
  day: { top: [255, 255, 255], mid: [230, 239, 248], bottom: [199, 216, 234] },
  night: { top: [214, 226, 255], mid: [178, 196, 236], bottom: [138, 160, 206] },
  warm: { top: [255, 228, 204], mid: [246, 216, 200], bottom: [206, 186, 200] },
};

const round = (value: number, digits = 3) => Math.round(value * 10 ** digits) / 10 ** digits;
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

/** Ein weicher Hügel: steigt von `start` bis `peak`, fällt bis `end`. */
function bump(t: number, start: number, peak: number, end: number): number {
  if (t <= start || t >= end) return 0;
  return t < peak ? smooth((t - start) / (peak - start)) : smooth((end - t) / (end - peak));
}

/** Wolken 0…1 aus dem WMO-Code von Open-Meteo; ohne Code etwas bedeckt - lieber zu wenige Sterne als falsche. */
export function cloudCover(code: number | string | null | undefined): number {
  if (code === null || code === undefined || code === "") return 0.35;
  const value = Number(code);
  if (!Number.isFinite(value)) return 0.35;
  if (value <= 0) return 0;
  if (value === 1) return 0.15;
  if (value === 2) return 0.5;
  if (value === 3) return 0.9;
  if (value >= 80 && value <= 82) return 0.85;
  if (value === 85 || value === 86) return 0.9;
  // Nebel (45, 48), Niesel, Regen, Schnee, Gewitter: zu.
  return 1;
}

/** Nacht 0…1: nach dem Untergang in der Dämmerung weich dunkel, vor dem Aufgang weich hell, dazwischen Tag. */
export function nightAmount(now: number, rise: number, set: number): number {
  if (now >= set) return smooth((now - set) / TWILIGHT_MS);
  if (now < rise) return smooth((rise - now) / TWILIGHT_MS);
  return 0;
}

/** Das Licht des Augenblicks - wie `skyLight` im Web. Ohne Sonnenzeiten zählt nur `night` (ja/nein) vom Server. */
export function skyLight({ now = Date.now(), sunrise = null, sunset = null, code = null, night = null }: { now?: number | string | Date; sunrise?: string | null; sunset?: string | null; code?: number | string | null; night?: boolean | null } = {}): SkyLight {
  const t = typeof now === "number" ? now : new Date(now).getTime();
  const rise = Date.parse(sunrise || "");
  const set = Date.parse(sunset || "");
  const clouds = cloudCover(code);
  let dark = night ? 1 : 0;
  let warmth = 0;
  let side = SUN_SIDE.dusk;
  if (Number.isFinite(rise) && Number.isFinite(set) && set > rise) {
    dark = nightAmount(t, rise, set);
    const dusk = bump(t, set - GLOW_MS, set + 5 * 60000, set + GLOW_MS);
    const dawn = bump(t, rise - GLOW_MS, rise - 5 * 60000, rise + GLOW_MS);
    warmth = Math.max(dusk, dawn) * (1 - 0.7 * clouds);
    side = dawn > dusk ? SUN_SIDE.dawn : SUN_SIDE.dusk;
  }
  return {
    night: round(dark),
    warmth: round(warmth),
    side,
    clouds: round(clouds),
    stars: round(dark * (1 - clouds) ** 1.5),
    moon: round((0.25 + 0.75 * dark) * (1 - 0.85 * clouds)),
  };
}

const hex = (rgb: number[]) => `#${rgb.map((value) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0")).join("")}`;

/** Die Farben von Schnee an der Stelle `x` (0…1 der Breite) - wie die Hauben im Web; die App rechnet sie mit (Parität). */
export function snowLightAt(light: SkyLight, x = 0.5, moonX: number | null = null): SnowTone {
  const near = (from: number, reach: number) => 1 - Math.min(1, Math.abs(x - from) / reach);
  const warm = light.warmth * (0.35 + 0.65 * near(light.side, 0.7));
  const cool = light.night * (1 - warm);
  const moonLit = moonX === null || moonX === undefined ? 0 : light.night * light.moon * near(moonX, 0.35);
  const mix = (key: "top" | "mid" | "bottom") => SNOW.day[key].map((day, i) => {
    let value = day + (SNOW.night[key][i] - day) * cool;
    value += (SNOW.warm[key][i] - value) * warm;
    return value + (255 - value) * moonLit * 0.45;
  });
  return { top: hex(mix("top")), mid: hex(mix("mid")), bottom: hex(mix("bottom")) };
}

/** Die Sterne des Winterhimmels: je Jahr anders, im Jahr gleich - dieselben wie im Web. */
export function winterStars(year: number | string, count = 32): WinterStar[] {
  const rng = seasonRng({ season: "snow", year, screen: "sky" }, "stars");
  return Array.from({ length: count }, (_, index) => ({
    index,
    x: round(0.02 + rng() * 0.96, 4),
    y: round(0.03 + rng() * 0.49, 4),
    r: round(0.6 + rng() * 1.1, 2),
    bright: round(0.35 + rng() * 0.55, 2),
    phase: round(rng(), 3),
  }));
}
