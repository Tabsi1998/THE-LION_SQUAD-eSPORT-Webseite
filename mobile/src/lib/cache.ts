/**
 * Session-scoped in-memory fallback cache.
 *
 * Authenticated responses are never persisted across app restarts. Cache keys
 * include the account scope and canonical query parameters, and the complete
 * cache is cleared whenever the active account changes.
 */

const DEFAULT_TTL_MS = 10 * 60 * 1000;
const NO_CACHE_PATTERNS = [
  "/auth/",
  "/admin/",
  "/notifications/read",
  "/settings/site-banners/impression",
  "/settings/site-banners/click",
];

export type CacheEntry<T = unknown> = {
  data: T;
  timestamp: number;
  ttl: number;
};

const memoryCache = new Map<string, CacheEntry>();

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

function shouldCache(url: string): boolean {
  return !NO_CACHE_PATTERNS.some((pattern) => url.includes(pattern));
}

export async function setCached<T>(cacheKey: string, url: string, data: T, ttl = DEFAULT_TTL_MS): Promise<void> {
  if (!shouldCache(url)) return;
  memoryCache.set(cacheKey, { data, timestamp: Date.now(), ttl } as CacheEntry);
}

export async function invalidateCache(urlPattern?: string): Promise<void> {
  if (!urlPattern) {
    memoryCache.clear();
    return;
  }
  for (const key of memoryCache.keys()) {
    if (key.includes(urlPattern)) memoryCache.delete(key);
  }
}

export async function clearAllCache(): Promise<void> {
  memoryCache.clear();
}

export async function getStaleCache<T>(cacheKey: string, url: string): Promise<T | null> {
  if (!shouldCache(url)) return null;
  const entry = memoryCache.get(cacheKey);
  return entry ? entry.data as T : null;
}
