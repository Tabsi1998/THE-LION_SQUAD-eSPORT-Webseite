import axios from "axios";

const configuredBackendUrl = (process.env.REACT_APP_BACKEND_URL || "").trim().replace(/\/+$/, "");

export const API_BASE =
  configuredBackendUrl || (typeof window !== "undefined" ? window.location.origin : "");
export const API = `${API_BASE}/api`;

function getCookie(name) {
  const prefix = `${name}=`;
  return document.cookie
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix))
    ?.slice(prefix.length);
}

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

api.interceptors.request.use((config) => {
  const method = (config.method || "get").toUpperCase();
  if (UNSAFE_METHODS.has(method)) {
    const csrf = getCookie("csrf_token");
    if (csrf) config.headers["X-CSRF-Token"] = decodeURIComponent(csrf);
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
    if (error.response?.status === 401 && original && !original._retry && !authRequest) {
      original._retry = true;
      refreshPromise = refreshPromise || api.post("/auth/refresh").finally(() => { refreshPromise = null; });
      await refreshPromise;
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
