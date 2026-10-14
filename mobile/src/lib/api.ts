import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { API_BASE_URL, API_URL } from "../config";
import type { AuthResponse } from "../types";
import { buildCacheKey, getStaleEntry, setCached } from "./cache";
import { noteFresh, noteOffline } from "./network";
import { deviceHeaders } from "./deviceIdentity";
import { accessTokenExpired, isSessionRejected, tokenExpiry } from "./session";
import { isApiRequest } from "./siteUrls";

type TokenSnapshot = {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
  /** Zeitpunkt des Erhalts des Zugangs-Tokens auf der Geräteuhr (#1519) - die Laufzeit zählt ab hier. */
  accessReceivedAt?: number | null;
  /** Sitzungs-Generation (#1519): Anmelden, Kontowechsel und Abmelden zählen weiter, Erneuern nicht. */
  generation?: number;
};

type CacheAwareConfig = InternalAxiosRequestConfig & {
  _cacheKey?: string;
  _retry?: boolean;
  _offlineFallback?: boolean;
  /** Die Sitzungs-Generation beim Senden (#1519) - ein Aufruf der alten Sitzung wird nie mit der neuen wiederholt. */
  _generation?: number;
  /** Geht der Aufruf an den eigenen Server (#1060)? Nur dann trägt er Token und Gerät - und nur dann wird erneuert. */
  _ownServer?: boolean;
};

/** Das Ziel des Aufrufs samt Basisadresse - eine absolute Adresse ersetzt die Basis. */
function sendsToOwnServer(config: InternalAxiosRequestConfig): boolean {
  try {
    return isApiRequest(api.getUri(config));
  } catch {
    return false;
  }
}

let readTokens: () => TokenSnapshot = () => ({ accessToken: null, refreshToken: null, userId: null });
let persistSession: (session: AuthResponse) => Promise<void> = async () => {};
let clearSession: () => Promise<void> = async () => {};
let refreshInFlight: { token: string; promise: Promise<AuthResponse> } | null = null;

/**
 * Die Sitzung erneuern (#942) - ein Weg für alle: der 401-Nachschlag und der App-Start teilen sich eine laufende
 * Erneuerung, statt denselben Token zweimal zu drehen (der zweite Versuch fiel sonst außerhalb des Gnadenfensters
 * und der Server warf die ganze Sitzung weg). Ohne Token wird abgelehnt wie vom Server.
 */
export function refreshSession(token?: string | null): Promise<AuthResponse> {
  const refreshToken = token || readTokens().refreshToken;
  if (!refreshToken) return Promise.reject(new Error("Kein Erneuerungs-Token"));
  // Geteilt nur für denselben Erneuerungs-Token (#1519): eine neue Sitzung hängt sich nie an die Erneuerung einer alten.
  if (refreshInFlight?.token === refreshToken) return refreshInFlight.promise;
  const entry = {
    token: refreshToken,
    promise: api
      .post<AuthResponse>("/auth/mobile/refresh", { refresh_token: refreshToken })
      .then(({ data }) => data)
      .finally(() => {
        if (refreshInFlight === entry) refreshInFlight = null;
      }),
  };
  refreshInFlight = entry;
  return entry.promise;
}

/** Die Sitzung hat während der Erneuerung gewechselt (#1519): abgemeldet oder ein anderes Konto angemeldet. */
const SESSION_CHANGED = "Sitzung inzwischen gewechselt";

/**
 * Läuft das Zugangs-Token gleich ab (#1519)? Gerechnet ab Erhalt mit der Laufzeit aus dem Token - nicht gegen die
 * Geräteuhr. Ohne lesbaren Ablauf entscheidet wie bisher der Server.
 */
function accessTokenDue(token: string | null, receivedAt: number | null | undefined): boolean {
  return tokenExpiry(token) !== null && accessTokenExpired(token, Date.now(), 30, receivedAt ?? null);
}

/**
 * Erneuern und ablegen (#1519) - für den Nachschlag nach einem 401 und das Erneuern vor dem Aufruf. Nur eine vom Server
 * abgelehnte Erneuerung (401/403) beendet die Sitzung; Netzfehler, Zeitüberschreitung oder eine Störung des Servers
 * lassen sie stehen, der nächste Aufruf versucht es wieder. Liefert das neue Zugangs-Token.
 */
async function renewAccess(refreshToken: string): Promise<string> {
  // Ergebnis und Fehler gelten nur, solange dieselbe Sitzung aktiv ist: ein Abmelden oder Kontowechsel währenddessen
  // darf weder von der alten Sitzung überschrieben noch von ihrer abgelehnten Erneuerung abgemeldet werden.
  const generation = readTokens().generation;
  const stillCurrent = () => readTokens().generation === generation;
  try {
    const session = await refreshSession(refreshToken);
    if (!stillCurrent()) throw new Error(SESSION_CHANGED);
    await persistSession(session);
    return session.access_token;
  } catch (error) {
    if (isSessionRejected(error) && stillCurrent()) await clearSession();
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
  // Herkunft (#1060): eine Adresse anderer Herkunft (etwa aus einer Antwort) geht ohne Anmeldung und ohne Gerät raus.
  const ownServer = sendsToOwnServer(config);
  (config as CacheAwareConfig)._ownServer = ownServer;
  (config as CacheAwareConfig)._generation = readTokens().generation;
  if (!ownServer) {
    config.headers.delete("Authorization");
    return config;
  }
  let { accessToken, userId } = readTokens();
  const { refreshToken, accessReceivedAt, generation } = readTokens();
  // Abgelaufenes Zugangs-Token (#1519): erst erneuern, dann senden. Öffentliche Aufrufe (Dashboard, /auth/me) antworten
  // sonst mit 200 als Gast statt mit 401 - die App hielt sich dann still für abgemeldet, obwohl die Sitzung noch galt.
  if (accessToken && refreshToken && accessTokenDue(accessToken, accessReceivedAt) && !config.url?.includes("/auth/mobile/")) {
    try {
      accessToken = await renewAccess(refreshToken);
      userId = readTokens().userId;
    } catch (error) {
      // Hat die Sitzung inzwischen gewechselt (abgemeldet, anderes Konto), gilt die neue. Abgelehnt: die Sitzung ist zu
      // Ende, der Aufruf geht als Gast weiter. Sonst (Netz, Störung) mit dem alten Token - der Server entscheidet, der
      // 401-Nachschlag versucht es dann noch einmal.
      if (readTokens().generation !== generation) {
        ({ accessToken, userId } = readTokens());
      } else if (isSessionRejected(error)) {
        accessToken = null;
        userId = readTokens().userId;
      }
    }
  }
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  (config as CacheAwareConfig)._generation = readTokens().generation;
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
      // Kam die Antwort erst nach Abmelden oder Kontowechsel (#1057), gehört sie zur vorigen Sitzung: nicht ablegen.
      const sameSession = config._generation === readTokens().generation;
      if (config._cacheKey && config.url && sameSession) await setCached(config._cacheKey, config.url, response.data);
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
    const sameSession = original?._generation === readTokens().generation;
    if (error.response?.status === 401 && original?._ownServer && !original._retry && refreshToken && !isAuthCall && sameSession) {
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
