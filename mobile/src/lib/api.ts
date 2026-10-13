import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { API_BASE_URL, API_URL } from "../config";
import type { AuthResponse } from "../types";
import { buildCacheKey, getStaleEntry, setCached } from "./cache";
import { noteFresh, noteOffline } from "./network";
import { deviceHeaders } from "./deviceIdentity";
import { isSessionRejected, tokenExpiry } from "./session";

type TokenSnapshot = {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
};

type CacheAwareConfig = InternalAxiosRequestConfig & {
  _cacheKey?: string;
  _retry?: boolean;
  _offlineFallback?: boolean;
};

let readTokens: () => TokenSnapshot = () => ({ accessToken: null, refreshToken: null, userId: null });
let persistSession: (session: AuthResponse) => Promise<void> = async () => {};
let clearSession: () => Promise<void> = async () => {};
let refreshPromise: Promise<AuthResponse> | null = null;

/**
 * Die Sitzung erneuern (#942) - ein Weg für alle: der 401-Nachschlag und der App-Start teilen sich eine laufende
 * Erneuerung, statt denselben Token zweimal zu drehen (der zweite Versuch fiel sonst außerhalb des Gnadenfensters
 * und der Server warf die ganze Sitzung weg). Ohne Token wird abgelehnt wie vom Server.
 */
export function refreshSession(token?: string | null): Promise<AuthResponse> {
  const refreshToken = token || readTokens().refreshToken;
  if (!refreshToken) return Promise.reject(new Error("Kein Erneuerungs-Token"));
  refreshPromise =
    refreshPromise ||
    api
      .post<AuthResponse>("/auth/mobile/refresh", { refresh_token: refreshToken })
      .then(({ data }) => data)
      .finally(() => {
        refreshPromise = null;
      });
  return refreshPromise;
}

/** Läuft das Zugangs-Token gleich ab (#1519)? Nur bei lesbarem Ablauf - sonst entscheidet wie bisher der Server. */
function accessTokenDue(token: string | null, marginSeconds = 30): boolean {
  const exp = tokenExpiry(token);
  return exp !== null && exp * 1000 <= Date.now() + marginSeconds * 1000;
}

/**
 * Erneuern und ablegen (#1519) - für den Nachschlag nach einem 401 und das Erneuern vor dem Aufruf. Nur eine vom Server
 * abgelehnte Erneuerung (401/403) beendet die Sitzung; Netzfehler, Zeitüberschreitung oder eine Störung des Servers
 * lassen sie stehen, der nächste Aufruf versucht es wieder. Liefert das neue Zugangs-Token.
 */
async function renewAccess(refreshToken: string): Promise<string> {
  try {
    const session = await refreshSession(refreshToken);
    await persistSession(session);
    return session.access_token;
  } catch (error) {
    if (isSessionRejected(error)) await clearSession();
    throw error;
  }
}

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
  let { accessToken, userId } = readTokens();
  const { refreshToken } = readTokens();
  // Abgelaufenes Zugangs-Token (#1519): erst erneuern, dann senden. Öffentliche Aufrufe (Dashboard, /auth/me) antworten
  // sonst mit 200 als Gast statt mit 401 - die App hielt sich dann still für abgemeldet, obwohl die Sitzung noch galt.
  if (accessToken && refreshToken && accessTokenDue(accessToken) && !config.url?.includes("/auth/mobile/")) {
    try {
      accessToken = await renewAccess(refreshToken);
      userId = readTokens().userId;
    } catch (error) {
      // Abgelehnt: die Sitzung ist zu Ende, der Aufruf geht als Gast weiter. Sonst (Netz, Störung) mit dem alten Token -
      // der Server entscheidet, der 401-Nachschlag versucht es dann noch einmal.
      if (isSessionRejected(error)) {
        accessToken = null;
        userId = readTokens().userId;
      }
    }
  }
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  // Gerät je Installation (#942): Kennung und Name als Kopfzeilen - der Server zeigt das Gerät in der Sitzungsliste
  // und schließt beim Neu-Login die alte Sitzung desselben Geräts.
  for (const [name, value] of Object.entries(await deviceHeaders())) {
    config.headers.set(name, value);
  }

  // Bind every cached response to the account and exact query parameters.
  if (config.method?.toLowerCase() === "get" && config.url) {
    const scope = userId ? `user:${userId}` : accessToken ? "authenticated:pending" : "anonymous";
    (config as CacheAwareConfig)._cacheKey = buildCacheKey(config.url, config.params, scope);
  }

  return config;
});

// ─── Response Interceptor: Cache befüllen + Offline-Fallback ─────────────────
api.interceptors.response.use(
  async (response) => {
    // Eine echte Antwort: das Netz ist da (#1152, Offline-Leiste).
    noteFresh();
    // Erfolgreiche GET-Responses cachen
    if (response.config.method?.toLowerCase() === "get" && response.config.url) {
      const config = response.config as CacheAwareConfig;
      if (config._cacheKey && config.url) await setCached(config._cacheKey, config.url, response.data);
    }
    return response;
  },
  async (error: AxiosError) => {
    const original = error.config as CacheAwareConfig | undefined;
    const { refreshToken } = readTokens();
    const isAuthCall = original?.url?.includes("/auth/mobile/");

    // ── 401: Token-Refresh ──────────────────────────────────────────────────
    // Einmal erneuern und wiederholen. Endet die Sitzung, dann nur, weil der Server die Erneuerung ablehnt (#1519) - ein
    // zweiter 401 nach erfolgreicher Erneuerung oder ein 401 beim Anmelden betrifft nur diesen Aufruf, nicht die Sitzung.
    if (error.response?.status === 401 && original && !original._retry && refreshToken && !isAuthCall) {
      original._retry = true;
      try {
        const access = await renewAccess(refreshToken);
        original.headers.Authorization = `Bearer ${access}`;
        return api(original);
      } catch {
        return Promise.reject(error);
      }
    }

    // ── Offline-Fallback: Netzwerkfehler oder Timeout ──────────────────────
    const isNetworkError =
      !error.response && (
        error.code === "ECONNABORTED" ||      // Timeout
        error.code === "ERR_NETWORK" ||        // Kein Netz
        error.message?.includes("Network Error") ||
        error.message?.includes("timeout")
      );

    if (isNetworkError && original?.url && original._cacheKey && original.method?.toLowerCase() === "get" && !original._offlineFallback) {
      original._offlineFallback = true;
      const stale = await getStaleEntry(original._cacheKey, original.url);
      if (stale !== null) {
        // Stale-Daten als Response zurückgeben mit Offline-Marker; die Leiste zeigt ihren Stand (#1152).
        console.warn(`[LionsAPP] Offline – verwende gecachte Daten für: ${original.url}`);
        noteOffline(stale.timestamp);
        return {
          data: stale.data,
          status: 200,
          statusText: "OK (cached)",
          headers: {},
          config: original,
          request: null,
          _fromCache: true,
        };
      }
    }
    if (isNetworkError) noteOffline(null);

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
