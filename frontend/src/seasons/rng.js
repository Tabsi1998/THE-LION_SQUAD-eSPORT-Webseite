// Zufall, der je Seite gleich bleibt (#655): aus der Adresse wird eine Saat, aus der Saat ein Zufallsstrom.
// So sieht jede Seite anders aus, aber dieselbe Seite bei jedem Besuch gleich - „dynamisch, sauber berechnet“.

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

/** Zufallszahl zwischen min und max aus einem Strom. */
export function between(rng, min, max) {
  return min + rng() * (max - min);
}

/** Ein Element aus einer Liste. */
export function pick(rng, items) {
  return items[Math.floor(rng() * items.length) % items.length];
}
