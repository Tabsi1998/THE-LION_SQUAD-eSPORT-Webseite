import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { API_BASE_URL, API_URL } from "../config";
import type { AuthResponse } from "../types";
import { getCached, setCached, getStaleCache } from "./cache";

type TokenSnapshot = {
  accessToken: string | null;
  refreshToken: string | null;
};

let readTokens: () => TokenSnapshot = () => ({ accessToken: null, refreshToken: null });
let persistSession: (session: AuthResponse) => Promise<void> = async () => {};
let clearSession: () => Promise<void> = async () => {};
let refreshPromise: Promise<AuthResponse> | null = null;

export const api = axios.create({
  baseURL: API_URL,
  headers: { "Content-Type": "application/json" },
  timeout: 15000, // 15s Timeout – verhindert endloses Warten bei schlechtem Netz
});

export function responseFromCache(response: unknown): boolean {
  return Boolean((response as { _fromCache?: boolean } | null)?._fromCache);
}

export function configureAuthBridge(bridge: {
  readTokens: () => TokenSnapshot;
  persistSession: (session: AuthResponse) => Promise<void>;
  clearSession: () => Promise<void>;
}) {
  readTokens = bridge.readTokens;
  persistSession = bridge.persistSession;
  clearSession = bridge.clearSession;
}

// ─── Request Interceptor: Auth-Token + Cache-Check ───────────────────────────
api.interceptors.request.use(async (config: InternalAxiosRequestConfig) => {
  const { accessToken } = readTokens();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }

  // Für GET-Requests: Cache prüfen und als Metadata anhängen
  if (config.method?.toLowerCase() === "get" && config.url) {
    const cached = await getCached(config.url);
    if (cached !== null) {
      // Cache-Hit: Request trotzdem senden (Stale-While-Revalidate Strategie)
      // Der Response-Interceptor wird den Cache aktualisieren
      (config as InternalAxiosRequestConfig & { _cachedData?: unknown })._cachedData = cached;
    }
  }

  return config;
});

// ─── Response Interceptor: Cache befüllen + Offline-Fallback ─────────────────
api.interceptors.response.use(
  async (response) => {
    // Erfolgreiche GET-Responses cachen
    if (response.config.method?.toLowerCase() === "get" && response.config.url) {
      await setCached(response.config.url, response.data);
    }
    return response;
  },
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean; _offlineFallback?: boolean }) | undefined;
    const { refreshToken } = readTokens();
    const isAuthCall = original?.url?.includes("/auth/mobile/");

    // ── 401: Token-Refresh ──────────────────────────────────────────────────
    if (error.response?.status === 401 && original && !original._retry && refreshToken && !isAuthCall) {
      original._retry = true;
      refreshPromise =
        refreshPromise ||
        api
          .post<AuthResponse>("/auth/mobile/refresh", { refresh_token: refreshToken })
          .then(({ data }) => data)
          .finally(() => {
            refreshPromise = null;
          });
      try {
        const session = await refreshPromise;
        await persistSession(session);
        original.headers.Authorization = `Bearer ${session.access_token}`;
        return api(original);
      } catch {
        await clearSession();
        return Promise.reject(error);
      }
    }

    if (error.response?.status === 401 && refreshToken) {
      await clearSession();
      return Promise.reject(error);
    }

    // ── Offline-Fallback: Netzwerkfehler oder Timeout ──────────────────────
    const isNetworkError =
      !error.response && (
        error.code === "ECONNABORTED" ||      // Timeout
        error.code === "ERR_NETWORK" ||        // Kein Netz
        error.message?.includes("Network Error") ||
        error.message?.includes("timeout")
      );

    if (isNetworkError && original?.url && original.method?.toLowerCase() === "get" && !original._offlineFallback) {
      original._offlineFallback = true;
      const stale = await getStaleCache(original.url);
      if (stale !== null) {
        // Stale-Daten als Response zurückgeben mit Offline-Marker
        console.warn(`[LionsAPP] Offline – verwende gecachte Daten für: ${original.url}`);
        return {
          data: stale,
          status: 200,
          statusText: "OK (cached)",
          headers: {},
          config: original,
          request: null,
          _fromCache: true,
        };
      }
    }

    return Promise.reject(error);
  }
);

export function resolveMediaUrl(url?: string | null) {
  if (!url) return "";
  if (/^(https?:|data:|blob:)/i.test(url)) return url;
  const normalized = url.replace(/^\/+/, "");
  if (normalized.startsWith("api/")) return `${API_BASE_URL}/${normalized}`;
  return `${API_BASE_URL}/${normalized}`;
}

export function errorMessage(error: unknown, fallback = "Das hat nicht geklappt.") {
  if (axios.isAxiosError(error)) {
    // Netzwerkfehler – benutzerfreundliche Meldung
    if (!error.response) {
      if (error.code === "ECONNABORTED" || error.message?.includes("timeout")) {
        return "Verbindung zu langsam. Bitte versuche es erneut.";
      }
      return "Keine Internetverbindung. Bitte prüfe dein Netz.";
    }
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join(" | ");
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

/** Gibt true zurück wenn der Fehler ein Netzwerkfehler ist (kein Internet / Timeout) */
export function isOfflineError(error: unknown): boolean {
  if (!axios.isAxiosError(error)) return false;
  return !error.response && (
    error.code === "ECONNABORTED" ||
    error.code === "ERR_NETWORK" ||
    Boolean(error.message?.includes("Network Error")) ||
    Boolean(error.message?.includes("timeout"))
  );
}
