import axios, { AxiosError, InternalAxiosRequestConfig } from "axios";
import { API_BASE_URL, API_URL } from "../config";
import type { AuthResponse } from "../types";

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
});

export function configureAuthBridge(bridge: {
  readTokens: () => TokenSnapshot;
  persistSession: (session: AuthResponse) => Promise<void>;
  clearSession: () => Promise<void>;
}) {
  readTokens = bridge.readTokens;
  persistSession = bridge.persistSession;
  clearSession = bridge.clearSession;
}

api.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const { accessToken } = readTokens();
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

api.interceptors.response.use(
  (response) => response,
  async (error: AxiosError) => {
    const original = error.config as (InternalAxiosRequestConfig & { _retry?: boolean }) | undefined;
    const { refreshToken } = readTokens();
    const isAuthCall = original?.url?.includes("/auth/mobile/");

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
      const session = await refreshPromise;
      await persistSession(session);
      original.headers.Authorization = `Bearer ${session.access_token}`;
      return api(original);
    }

    if (error.response?.status === 401 && refreshToken) {
      await clearSession();
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
    const detail = error.response?.data?.detail;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) return detail.map((item) => item?.msg || String(item)).join(" | ");
    if (error.message) return error.message;
  }
  if (error instanceof Error) return error.message;
  return fallback;
}

