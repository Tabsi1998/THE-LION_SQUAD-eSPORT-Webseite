import { formatNewsCategory } from "./format";

// Filterzeile der News (#1946) - wie NewsFilterRow im Web (#1249, frontend/src/components/tls/NewsFilterRow.jsx): nur
// Kategorien mit Beiträgen, je mit Anzahl. Die App zählt die Beiträge, die sie geladen hat und filtert - so stimmt
// die Zahl mit dem, was nach dem Antippen zu sehen ist. Reihenfolge wie `/news-meta` im Backend (NEWS_CATEGORIES),
// unbekannte Kategorien dahinter nach Schlüssel.

const SERVER_ORDER = ["club", "tournaments", "events", "community", "sponsors", "members", "teams", "announcement", "recap", "maintenance"];

export type NewsCategoryCount = { key: string; label: string; count: number };

export function newsCategoryKey(value?: string | null): string {
  return String(value || "").trim().toLowerCase();
}

/** Kategorien mit Anzahl; die gewählte (`active`) bleibt sichtbar, auch wenn gerade nichts darin steht (Anzahl 0). */
export function newsCategoryCounts(items: Array<{ category?: string | null }>, active?: string | null): NewsCategoryCount[] {
  const counts = new Map<string, number>();
  for (const item of items || []) {
    const key = newsCategoryKey(item?.category);
    if (key) counts.set(key, (counts.get(key) || 0) + 1);
  }
  const wanted = newsCategoryKey(active);
  if (wanted && !counts.has(wanted)) counts.set(wanted, 0);
  const rank = (key: string) => {
    const index = SERVER_ORDER.indexOf(key);
    return index >= 0 ? index : SERVER_ORDER.length;
  };
  return Array.from(counts.entries())
    .sort(([a], [b]) => rank(a) - rank(b) || a.localeCompare(b))
    .map(([key, count]) => ({ key, label: formatNewsCategory(key), count }));
}
