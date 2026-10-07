import * as SecureStore from "expo-secure-store";

// Die letzten Suchen (#1145): das Gerät merkt sich die letzten fünf, die neueste oben. Abmelden löscht sie
// (AuthContext.clearSession) - wer das Handy weitergibt, gibt seine Suchen nicht mit.

const KEY = "tls.recent-searches";
export const RECENT_SEARCH_LIMIT = 5;
export const MIN_SEARCH_LENGTH = 2;

export async function loadRecentSearches(): Promise<string[]> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string" && entry.trim()).slice(0, RECENT_SEARCH_LIMIT) : [];
  } catch {
    return [];
  }
}

async function save(entries: string[]) {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(entries.slice(0, RECENT_SEARCH_LIMIT)));
  } catch {
    // ohne Speicher gilt die Liste nur bis zum nächsten Start
  }
}

/** Die neue Liste mit `query` oben - doppelte (auch in anderer Schreibweise) fallen weg. */
export function addRecentSearch(entries: string[], query: string): string[] {
  const clean = query.trim().replace(/\s+/g, " ");
  if (clean.length < MIN_SEARCH_LENGTH) return entries;
  return [clean, ...entries.filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, RECENT_SEARCH_LIMIT);
}

export async function rememberSearch(query: string): Promise<string[]> {
  const next = addRecentSearch(await loadRecentSearches(), query);
  await save(next);
  return next;
}

export async function forgetSearch(query: string): Promise<string[]> {
  const next = (await loadRecentSearches()).filter((entry) => entry !== query);
  await save(next);
  return next;
}

export async function clearRecentSearches(): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(KEY);
  } catch {
    // nichts gespeichert
  }
}
