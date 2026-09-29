// Zufall, der je Seite gleich bleibt (#655): aus der Adresse wird eine Saat, aus der Saat ein Zufallsstrom.
// So sieht jede Seite anders aus, aber dieselbe Seite bei jedem Besuch gleich - „dynamisch, sauber berechnet“.
// Seit dem Jahres-Seed (Seasonal Core C4, #724) kommt die Saat einer Saison aus Saison + Jahr + Adresse (+ Salz):
// ein Neuladen ändert die Szene nicht, das nächste Jahr würfelt sie neu. Die App hat dieselben Helfer in
// mobile/src/seasons/rng.ts (screenRng statt pageRng).

export function hashString(value) {
  let hash = 2166136261;
  const text = String(value || "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return hash >>> 0;
}

/** Mulberry32: kleiner, schneller Zufallsstrom mit fester Saat. */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Der Zufallsstrom einer Seite - `salt` trennt Verwendungen (Spinnweben, Kürbisse, Flüge). */
export function pageRng(pathname, salt = "") {
  return mulberry32(hashString(`${pathname || "/"}::${salt}`));
}

/** Saisons, die über Silvester gehen: im Januar bis Juni zählen sie noch zum Jahr ihres Beginns. */
export const SPANS_NEW_YEAR = ["winter", "snow", "new_year", "advent_calendar", "christmas"];

/**
 * Das Jahr einer Saison: aus `starts_at` des Servers, sonst aus der Uhr - eine Saison, die über Silvester geht,
 * zählt zum Jahr ihres Beginns. Kein fester Jahres-Check: die Engine kennt nur „dieses Saisonjahr“.
 */
export function seasonYear(season = null, now = new Date()) {
  const key = typeof season === "string" ? season : season && season.key;
  const start = season && typeof season === "object" ? Date.parse(season.starts_at || "") : NaN;
  if (Number.isFinite(start)) return new Date(start).getFullYear();
  const year = now.getFullYear();
  return SPANS_NEW_YEAR.includes(key) && now.getMonth() < 6 ? year - 1 : year;
}

/**
 * Die Saat einer Saison: `saison:jahr:route[:salz]`. `season` ist der Schlüssel oder das Saison-Objekt vom Server
 * (dann kommt das Jahr aus `starts_at`); `salt` ist frei für Gerät oder Nutzer - ohne Salz sehen alle dasselbe,
 * was Abnahmen reproduzierbar macht.
 */
export function seasonSeed({ season = "season", year = null, route = "/", salt = "" } = {}) {
  const key = (typeof season === "string" ? season : season && season.key) || "season";
  const seasonYearOf = year === null || year === undefined ? seasonYear(season) : year;
  return `${key}:${seasonYearOf}:${route || "/"}${salt ? `:${salt}` : ""}`;
}

/** Der Zufallsstrom einer Saison auf einer Route - `use` trennt Verwendungen wie bei `pageRng`. */
export function seasonRng(spec, use = "") {
  return pageRng(seasonSeed(spec), use);
}

/** Zufallszahl zwischen min und max aus einem Strom. */
export function between(rng, min, max) {
  return min + rng() * (max - min);
}

/** Ein Element aus einer Liste. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length) % items.length];
}
