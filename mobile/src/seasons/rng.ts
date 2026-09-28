// Zufall, der je Screen gleich bleibt (#655): aus dem Screen-Namen wird eine Saat, aus der Saat ein
// Zufallsstrom - jeder Screen sieht anders aus, derselbe Screen bei jedem Besuch gleich. Dieselbe
// Rechnung wie im Web (frontend/src/seasons/rng.js).

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

export function between(rng: () => number, min: number, max: number): number {
  return min + rng() * (max - min);
}

export function pick<T>(rng: () => number, items: T[]): T {
  return items[Math.floor(rng() * items.length) % items.length];
}
