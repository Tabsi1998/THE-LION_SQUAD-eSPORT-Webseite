// Die letzten Suchen (#1145) - wie in der App: die letzten fünf, die neueste oben, im Browser gemerkt. Abmelden löscht
// sie (AuthContext.logout), damit ein geteilter Rechner die Suchen nicht weitergibt.

const KEY = "tls-recent-searches";
export const RECENT_SEARCH_LIMIT = 5;
export const MIN_SEARCH_LENGTH = 2;

export function loadRecentSearches() {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string" && entry.trim()).slice(0, RECENT_SEARCH_LIMIT) : [];
  } catch {
    return [];
  }
}

function save(entries) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(entries.slice(0, RECENT_SEARCH_LIMIT)));
  } catch {
    // ohne Speicher gilt die Liste nur für diesen Besuch
  }
}

/** Die neue Liste mit `query` oben - doppelte (auch in anderer Schreibweise) fallen weg. */
export function addRecentSearch(entries, query) {
  const clean = String(query || "").trim().replace(/\s+/g, " ");
  if (clean.length < MIN_SEARCH_LENGTH) return entries;
  return [clean, ...entries.filter((entry) => entry.toLowerCase() !== clean.toLowerCase())].slice(0, RECENT_SEARCH_LIMIT);
}

export function rememberSearch(query) {
  const next = addRecentSearch(loadRecentSearches(), query);
  save(next);
  return next;
}

export function forgetSearch(query) {
  const next = loadRecentSearches().filter((entry) => entry !== query);
  save(next);
  return next;
}

export function clearRecentSearches() {
  try {
    window.localStorage.removeItem(KEY);
  } catch {
    // nichts gespeichert
  }
}
