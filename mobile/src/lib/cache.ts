/**
 * cache.ts — In-Memory + SecureStore-basierter Offline-Cache für die LionsAPP.
 *
 * Funktionsweise:
 * - GET-Requests werden nach erfolgreichem Laden im Memory-Cache gespeichert (TTL-basiert).
 * - Wichtige Endpunkte werden zusätzlich in expo-secure-store persistiert (max. ~2KB pro Eintrag).
 * - Bei Netzwerkfehler (offline / timeout) wird der Cache-Eintrag zurückgegeben.
 * - Cache-Einträge laufen nach DEFAULT_TTL_MS ab (Standard: 10 Minuten).
 * - Kritische Endpunkte (Auth, POST/PUT/DELETE) werden nie gecacht.
 *
 * Kein externes Package nötig – nur expo-secure-store (bereits installiert).
 */

import * as SecureStore from "expo-secure-store";

const CACHE_PREFIX = "tls_cache_";
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 Minuten

// Endpunkte die NICHT gecacht werden sollen
const NO_CACHE_PATTERNS = [
  "/auth/",
  "/admin/",
  "/notifications/read",
  "/settings/site-banners/impression",
  "/settings/site-banners/click",
];

// Endpunkte die in SecureStore persistiert werden (für Offline-Fallback nach App-Neustart)
const PERSIST_PATTERNS = [
  "/mobile/dashboard",
  "/mobile/news",
  "/mobile/tournaments",
  "/seasons/",
  "/mobile/profile",
];

export type CacheEntry<T = unknown> = {
  data: T;
  timestamp: number;
  ttl: number;
};

// In-Memory Cache (schnell, kein I/O)
const memoryCache = new Map<string, CacheEntry>();

function sanitizeKey(url: string): string {
  // SecureStore erlaubt nur alphanumerische Zeichen + _ und .
  return (CACHE_PREFIX + url).replace(/[^a-zA-Z0-9_.]/g, "_").slice(0, 255);
}

function shouldCache(url: string): boolean {
  return !NO_CACHE_PATTERNS.some((pattern) => url.includes(pattern));
}

function shouldPersist(url: string): boolean {
  return PERSIST_PATTERNS.some((pattern) => url.includes(pattern));
}

/** Gecachten Wert lesen (Memory zuerst, dann SecureStore) */
export async function getCached<T>(url: string): Promise<T | null> {
  if (!shouldCache(url)) return null;

  // 1. Memory-Cache prüfen
  const memEntry = memoryCache.get(url);
  if (memEntry) {
    const age = Date.now() - memEntry.timestamp;
    if (age <= memEntry.ttl) {
      return memEntry.data as T;
    }
    memoryCache.delete(url);
  }

  // 2. SecureStore prüfen (nur für persistierte Endpunkte)
  if (shouldPersist(url)) {
    try {
      const raw = await SecureStore.getItemAsync(sanitizeKey(url));
      if (raw) {
        const entry: CacheEntry<T> = JSON.parse(raw);
        const age = Date.now() - entry.timestamp;
        if (age <= entry.ttl) {
          // Zurück in Memory-Cache laden
          memoryCache.set(url, entry);
          return entry.data;
        }
      }
    } catch {
      // SecureStore-Fehler ignorieren
    }
  }

  return null;
}

/** Wert in Cache speichern */
export async function setCached<T>(url: string, data: T, ttl = DEFAULT_TTL_MS): Promise<void> {
  if (!shouldCache(url)) return;

  const entry: CacheEntry<T> = { data, timestamp: Date.now(), ttl };

  // Immer in Memory speichern
  memoryCache.set(url, entry as CacheEntry);

  // Zusätzlich in SecureStore für wichtige Endpunkte
  if (shouldPersist(url)) {
    try {
      const serialized = JSON.stringify(entry);
      // SecureStore hat ein Limit von ~2KB – nur kleine Payloads speichern
      if (serialized.length < 2000) {
        await SecureStore.setItemAsync(sanitizeKey(url), serialized);
      }
    } catch {
      // SecureStore-Fehler ignorieren
    }
  }
}

/** Cache-Eintrag löschen */
export async function invalidateCache(urlPattern?: string): Promise<void> {
  if (urlPattern) {
    for (const key of memoryCache.keys()) {
      if (key.includes(urlPattern)) {
        memoryCache.delete(key);
      }
    }
  } else {
    memoryCache.clear();
  }
}

/** Alle gecachten Daten löschen */
export async function clearAllCache(): Promise<void> {
  memoryCache.clear();
}

/**
 * Gibt gecachte Daten zurück, auch wenn TTL abgelaufen (Stale-Fallback).
 * Nützlich wenn das Netz nicht verfügbar ist.
 */
export async function getStaleCache<T>(url: string): Promise<T | null> {
  if (!shouldCache(url)) return null;

  // Memory-Cache (auch abgelaufen)
  const memEntry = memoryCache.get(url);
  if (memEntry) return memEntry.data as T;

  // SecureStore (auch abgelaufen)
  if (shouldPersist(url)) {
    try {
      const raw = await SecureStore.getItemAsync(sanitizeKey(url));
      if (raw) {
        const entry: CacheEntry<T> = JSON.parse(raw);
        return entry.data;
      }
    } catch {}
  }

  return null;
}
