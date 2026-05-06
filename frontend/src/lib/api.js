import axios from "axios";

const configuredBackendUrl = (process.env.REACT_APP_BACKEND_URL || "").trim().replace(/\/+$/, "");

export const API_BASE =
  configuredBackendUrl || (typeof window !== "undefined" ? window.location.origin : "");
export const API = `${API_BASE}/api`;

export function resolveMediaUrl(url) {
  if (!url) return "";
  const value = String(url);
  if (/^(https?:|data:|blob:)/i.test(value)) return value;
  return `${API_BASE}${value.startsWith("/") ? value : `/${value}`}`;
}

function getCookie(name) {
  if (typeof document === "undefined") return "";
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

function decodeCookieValue(value) {
  if (!value) return "";
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function ensureHeaders(config) {
  if (!config.headers) config.headers = {};
  return config.headers;
}

function setHeader(headers, name, value) {
  if (!headers || !value) return;
  if (typeof headers.set === "function") headers.set(name, value);
  else headers[name] = value;
}

function deleteHeader(headers, name) {
  if (!headers) return;
  if (typeof headers.delete === "function") headers.delete(name);
  else delete headers[name];
}

function applyCsrfHeader(config) {
  const csrf = decodeCookieValue(getCookie("csrf_token"));
  if (csrf) setHeader(ensureHeaders(config), "X-CSRF-Token", csrf);
}

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

api.interceptors.request.use((config) => {
  const method = (config.method || "get").toUpperCase();
  const headers = ensureHeaders(config);
  if (config.data instanceof FormData) {
    deleteHeader(headers, "Content-Type");
    deleteHeader(headers, "content-type");
  }
  if (method === "GET") {
    setHeader(headers, "Cache-Control", "no-cache");
    setHeader(headers, "Pragma", "no-cache");
  }
  if (UNSAFE_METHODS.has(method)) {
    applyCsrfHeader(config);
  }
  return config;
});

let refreshPromise = null;

api.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    const url = original?.url || "";
    const authRequest = url.includes("/auth/login") || url.includes("/auth/register") || url.includes("/auth/refresh");
    const detail = formatApiError(error.response?.data?.detail);
    const csrfError = error.response?.status === 403 && /csrf token missing or invalid/i.test(detail);
    if (error.response?.status === 401 && original && !original._retry && !authRequest) {
      original._retry = true;
      refreshPromise = refreshPromise || api.post("/auth/refresh").finally(() => { refreshPromise = null; });
      await refreshPromise;
      return api(original);
    }
    if (csrfError && original && !original._csrfRetry && !authRequest) {
      original._csrfRetry = true;
      refreshPromise = refreshPromise || api.post("/auth/refresh").finally(() => { refreshPromise = null; });
      await refreshPromise;
      applyCsrfHeader(original);
      return api(original);
    }
    return Promise.reject(error);
  }
);

export function formatApiError(detail) {
  if (detail == null) return "Ein Fehler ist aufgetreten.";
  if (typeof detail === "string") return detail;
  if (Array.isArray(detail))
    return detail
      .map((e) => (e && typeof e.msg === "string" ? e.msg : JSON.stringify(e)))
      .filter(Boolean)
      .join(" | ");
  if (detail && typeof detail.msg === "string") return detail.msg;
  return String(detail);
}

export function suggestSlug(value) {
  const base = String(value || "eintrag")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70) || "eintrag";
  return `${base}-${new Date().getFullYear()}`;
}

export function formatRequestError(error, fallback = "Ein Fehler ist aufgetreten.", context = {}) {
  const detail = error?.response?.data?.detail;
  const message = formatApiError(detail);
  if (/slug bereits vergeben/i.test(message)) {
    const suggestion = suggestSlug(context.slug || context.title || context.name);
    return `${message} Vorschlag: ${suggestion}`;
  }
  if (message && message !== "Ein Fehler ist aufgetreten.") return message;
  if (error?.message) return error.message;
  return fallback;
}

export function formatMs(ms) {
  if (ms == null) return "-";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(mil).padStart(3, "0")}`;
}

export function formatMemberSince(value, precision = "day") {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  if (precision === "year") return String(date.getFullYear());
  if (precision === "month") {
    return date.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
  }
  return date.toLocaleDateString("de-DE", { dateStyle: "long" });
}

export function parseTimeStr(str) {
  if (!str) return null;
  const trimmed = String(str).trim();
  const m = trimmed.match(/^(?:(\d+):)?(\d{1,2})\.(\d{1,3})$/);
  if (!m) return null;
  const mins = parseInt(m[1] || "0", 10);
  const secs = parseInt(m[2], 10);
  const mils = parseInt(m[3].padEnd(3, "0"), 10);
  return mins * 60000 + secs * 1000 + mils;
}
