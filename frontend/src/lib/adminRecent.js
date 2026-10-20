// „Zuletzt“ im Admin-Menü (#1291): die zuletzt geöffneten Verwaltungsseiten, im Browser gemerkt und je Konto getrennt.
// Gespeichert wird nur der Menü-Weg (`to`); was davon jemand sehen darf, entscheidet das Menü beim Anzeigen.

export const ADMIN_RECENT_MAX = 5;
const STORAGE_PREFIX = "tls_admin_recent_v1:";

function storageKey(userId) {
  return userId ? `${STORAGE_PREFIX}${userId}` : null;
}

export function readRecentAdminPages(userId) {
  const key = storageKey(userId);
  if (!key) return [];
  try {
    const stored = JSON.parse(window.localStorage.getItem(key));
    return Array.isArray(stored) ? stored.filter((entry) => typeof entry === "string").slice(0, ADMIN_RECENT_MAX + 1) : [];
  } catch {
    return [];
  }
}

// Die neueste Seite steht vorne, jede nur einmal. Gemerkt werden eine mehr als angezeigt: die gerade offene Seite
// zeigt „Zuletzt“ nicht an, die übrigen fünf bleiben so sichtbar.
export function rememberRecentAdminPage(userId, to, current = readRecentAdminPages(userId)) {
  const key = storageKey(userId);
  if (!key || !to) return current;
  const next = [to, ...current.filter((entry) => entry !== to)].slice(0, ADMIN_RECENT_MAX + 1);
  try {
    window.localStorage.setItem(key, JSON.stringify(next));
  } catch {
    // Privates Fenster oder gesperrter Speicher: dann gilt die Liste nur bis zum Neuladen.
  }
  return next;
}
