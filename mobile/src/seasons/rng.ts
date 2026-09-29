// Zufall, der je Screen gleich bleibt (#655): aus dem Screen-Namen wird eine Saat, aus der Saat ein
// Zufallsstrom - jeder Screen sieht anders aus, derselbe Screen bei jedem Besuch gleich. Dieselbe
// Rechnung wie im Web (frontend/src/seasons/rng.js). Seit dem Jahres-Seed (Seasonal Core C4, #724) kommt die
// Saat einer Saison aus Saison + Jahr + Screen (+ Salz): ein Neustart ändert die Szene nicht, das nächste Jahr
// würfelt sie neu.

export function hashString(value: string): number {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: kleiner, schneller Zufallsstrom mit fester Saat. */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function screenRng(screen: string, salt = ""): () => number {
  return mulberry32(hashString(`${screen || "Dashboard"}::${salt}`));
}

/** Eine Saison als Schlüssel oder als Objekt vom Server (dann zählt `starts_at` für das Jahr). */
export type SeasonLike = string | { key: string; starts_at?: string | null } | null | undefined;

/** Saisons, die über Silvester gehen: im Januar bis Juni zählen sie noch zum Jahr ihres Beginns. */
export const SPANS_NEW_YEAR = ["winter", "new_year"];

/**
 * Das Jahr einer Saison: aus `starts_at` des Servers, sonst aus der Uhr - eine Saison, die über Silvester geht,
 * zählt zum Jahr ihres Beginns. Kein fester Jahres-Check: die Engine kennt nur „dieses Saisonjahr“.
 */
export function seasonYear(season: SeasonLike = null, now: Date = new Date()): number {
  const key = typeof season === "string" ? season : season?.key;
  const start = season && typeof season === "object" ? Date.parse(season.starts_at || "") : NaN;
  if (Number.isFinite(start)) return new Date(start).getFullYear();
  const year = now.getFullYear();
  return key && SPANS_NEW_YEAR.includes(key) && now.getMonth() < 6 ? year - 1 : year;
}

export type SeasonSeedSpec = { season?: SeasonLike; year?: number | string | null; screen?: string; salt?: string };

/**
 * Die Saat einer Saison: `saison:jahr:screen[:salz]`. `salt` ist frei für Gerät oder Nutzer - ohne Salz sehen alle
 * dasselbe, was Abnahmen reproduzierbar macht.
 */
export function seasonSeed({ season = "season", year = null, screen = "Dashboard", salt = "" }: SeasonSeedSpec = {}): string {
  const key = (typeof season === "string" ? season : season?.key) || "season";
  const seasonYearOf = year === null || year === undefined ? seasonYear(season) : year;
  return `${key}:${seasonYearOf}:${screen || "Dashboard"}${salt ? `:${salt}` : ""}`;
}

/** Der Zufallsstrom einer Saison auf einem Screen - `use` trennt Verwendungen wie bei `screenRng`. */
export function seasonRng(spec: SeasonSeedSpec, use = ""): () => number {
  return screenRng(seasonSeed(spec), use);
}

export function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}
