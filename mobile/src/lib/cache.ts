/**
 * Session-scoped in-memory fallback cache.
 *
 * Authenticated responses are never persisted across app restarts. Cache keys
 * include the account scope and canonical query parameters, and the complete
 * cache is cleared whenever the active account changes.
 *
 * Höchstalter und Obergrenze (#1058, Entscheidung Fabian vom 14.10.2026):
 * - Der Speicher bleibt bewusst im Arbeitsspeicher - nichts landet über den Neustart hinaus auf dem Gerät, passend zum
 *   Schutz beim Konto- und Sitzungswechsel (#1053, #1059).
 * - Ein Eintrag hilft offline höchstens 24 Stunden aus; danach wird er beim Lesen verworfen und der Screen zeigt seinen
 *   Offline-Fehler statt alter Zahlen. Schnelllebige Pfade (LIVE_PATHS: Turnierbaum, Tabellen, Anmeldeliste, Spiele,
 *   Livestreams, Benachrichtigungen, Teamtag) nur 1 Stunde - ein Spielstand von gestern wäre irreführend.
 * - Höchstens 200 Einträge und etwa 5 MB (Länge des JSON-Texts); darüber fliegt der am längsten ungenutzte Eintrag
 *   zuerst raus (Lesen zählt als Nutzung). Eine Einzelantwort über 1 MB wird gar nicht abgelegt.
 */

/** Höchstalter eines Eintrags für den Offline-Fall (ms). */
export const MAX_AGE_MS = 24 * 60 * 60 * 1000;
/** Kürzeres Höchstalter für schnelllebige Pfade (ms). */
export const LIVE_MAX_AGE_MS = 60 * 60 * 1000;
/** Höchstzahl der Einträge. */
export const MAX_ENTRIES = 200;
/** Geschätzte Gesamtgröße aller Einträge (Zeichen des JSON-Texts, ~5 MB). */
export const MAX_TOTAL_BYTES = 5 * 1024 * 1024;
/** Größere Einzelantworten werden nicht abgelegt. */
export const MAX_ENTRY_BYTES = 1024 * 1024;

// Schnelllebige Pfade (#1058): Turnierbaum, Tabellen und Anmeldeliste eines Turniers, Spielseiten, Saisontabellen,
// Livestreams, Benachrichtigungen und der Teamtag.
const LIVE_PATHS = [
  /^\/?tournaments\/[^/?#]+\/(bracket|standings|registrations)(?:[/?#]|$)/,
  /^\/?seasons\/[^/?#]+\/standings(?:[/?#]|$)/,
  /^\/?matches\/[^?#]/,
  /^\/?streams\/live(?:[/?#]|$)/,
  /^\/?(mobile\/)?notifications(?:[/?#]|$)/,
  /^\/?team-day\//,
];

const NO_CACHE_PATTERNS = [
  "/auth/",
  "/admin/",
  "/chat-attachments/",
  "/notifications/read",
  "/settings/site-banners/impression",
  "/settings/site-banners/click",
  // Ostereier tragen kurzlebige, persönliche Schlüssel - eine alte Antwort hilft offline nicht.
  "/seasonal/easter/",
];

export type CacheEntry<T = unknown> = {
  data: T;
  timestamp: number;
  ttl: number;
};

// Die Reihenfolge der Map ist die Nutzung: vorne der am längsten ungenutzte Eintrag (Lesen und Schreiben setzen ans Ende).
const memoryCache = new Map<string, CacheEntry>();
const entrySizes = new Map<string, number>();
let totalBytes = 0;

function removeEntry(cacheKey: string) {
  if (!memoryCache.has(cacheKey)) return;
  memoryCache.delete(cacheKey);
  totalBytes -= entrySizes.get(cacheKey) ?? 0;
  entrySizes.delete(cacheKey);
}

function clearMemory() {
  memoryCache.clear();
  entrySizes.clear();
  totalBytes = 0;
}

function apiPath(url: string): string {
  return url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/?api(?=\/)/, "");
}

/** Das Höchstalter für einen Pfad (#1058): schnelllebige Pfade kürzer. */
export function maxAgeFor(url: string): number {
  const path = apiPath(url);
  return LIVE_PATHS.some((pattern) => pattern.test(path)) ? LIVE_MAX_AGE_MS : MAX_AGE_MS;
}

function sizeOf(data: unknown): number {
  try {
    return JSON.stringify(data ?? null).length;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

/** Zahl und geschätzte Größe der Einträge (für Tests und Diagnose). */
export function cacheStats(): { entries: number; bytes: number } {
  return { entries: memoryCache.size, bytes: totalBytes };
}

function stableValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stableValue);
  if (typeof URLSearchParams !== "undefined" && value instanceof URLSearchParams) {
    return [...value.entries()].sort(([left], [right]) => left.localeCompare(right));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([, item]) => item !== undefined)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, stableValue(item)]),
    );
  }
  return value;
}

export function buildCacheKey(url: string, params: unknown, accountScope: string): string {
  const canonicalParams = params == null ? "" : JSON.stringify(stableValue(params));
  return `${accountScope || "anonymous"}::${url}::${canonicalParams}`;
}

// Persönliche Antworten, die der Server mit „Cache-Control: private, no-store“ schickt und die keinen Offline-Stand
// brauchen (#1187, #1188): der Rückblick mit „Du warst dabei“, die Freunde bei Event, Turnier und Fast Lap und ob der
// einmalige Hinweis fällig ist. Bewusst eine Liste statt
// der Kopfzeile - „no-store“ trägt fast jede API-Antwort (Middleware im Server), und „private“ tragen auch Kalender
// und Adventkalender, deren Offline-Stand gewollt ist.
const NO_CACHE_PATHS = [
  /^\/?events\/[^/?#]+\/(recap|friends)(?:[?#]|$)/,
  /^\/?tournaments\/[^/?#]+\/friends(?:[?#]|$)/,
  /^\/?f1\/challenges\/[^/?#]+\/friends(?:[?#]|$)/,
  /^\/?users\/me\/friends-hint(?:[?#]|$)/,
  // Abo-Hinweis und Abo-Stand (#1788): eine alte Antwort zeigte den Hinweis ein zweites Mal oder ein abgeschaltetes Abo.
  /^\/?calendar\/(hint|personal)(?:[?#]|$)/,
];

export function shouldCache(url: string): boolean {
  const path = apiPath(url);
  return !NO_CACHE_PATTERNS.some((pattern) => url.includes(pattern)) && !NO_CACHE_PATHS.some((pattern) => pattern.test(path));
}

export async function setCached<T>(cacheKey: string, url: string, data: T, ttl = maxAgeFor(url)): Promise<void> {
  if (!shouldCache(url)) return;
  // Der vorige Stand desselben Schlüssels geht immer - auch wenn der neue zu groß ist, bleibt kein veralteter zurück.
  removeEntry(cacheKey);
  const size = sizeOf(data);
  if (size > MAX_ENTRY_BYTES) return;
  memoryCache.set(cacheKey, { data, timestamp: Date.now(), ttl } as CacheEntry);
  entrySizes.set(cacheKey, size);
  totalBytes += size;
  // Verdrängen nach letzter Nutzung, bis Zahl und Größe passen.
  for (const oldest of [...memoryCache.keys()]) {
    if (memoryCache.size <= MAX_ENTRIES && totalBytes <= MAX_TOTAL_BYTES) break;
    if (oldest === cacheKey) break;
    removeEntry(oldest);
  }
}

export async function invalidateCache(urlPattern?: string): Promise<void> {
  if (!urlPattern) {
    clearMemory();
    return;
  }
  for (const key of [...memoryCache.keys()]) {
    if (key.includes(urlPattern)) removeEntry(key);
  }
}

const clearers = new Set<() => void | Promise<void>>();

/** Wer eigene Zwischenspeicher hält (Chat-Bilder, geladene Dateien), räumt mit auf, wenn das Konto wechselt. */
export function registerCacheClearer(clear: () => void | Promise<void>) {
  clearers.add(clear);
}

/**
 * Alles weg, was am Konto hängt. Abmelden und Kontowechsel warten, bis auch die Dateien gelöscht sind (#1059); ein
 * Aufräumer, der scheitert, hält die anderen nicht auf.
 */
export async function clearAllCache(): Promise<void> {
  clearMemory();
  await Promise.all([...clearers].map((clear) => Promise.resolve().then(clear).catch(() => {})));
}

export async function getStaleCache<T>(cacheKey: string, url: string): Promise<T | null> {
  const entry = await getStaleEntry<T>(cacheKey, url);
  return entry ? entry.data : null;
}

/**
 * Der gespeicherte Eintrag samt Zeit (#1152: „Offline · Stand 14:05“ zeigt, wie alt die gezeigten Daten sind). Älter als
 * sein Höchstalter (`ttl`, #1058): weg damit, der Aufrufer bekommt nichts.
 */
export async function getStaleEntry<T>(cacheKey: string, url: string): Promise<CacheEntry<T> | null> {
  if (!shouldCache(url)) return null;
  const entry = memoryCache.get(cacheKey);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > entry.ttl) {
    removeEntry(cacheKey);
    return null;
  }
  // Gelesen heißt genutzt: ans Ende der Verdrängungs-Reihenfolge.
  memoryCache.delete(cacheKey);
  memoryCache.set(cacheKey, entry);
  return entry as CacheEntry<T>;
}
