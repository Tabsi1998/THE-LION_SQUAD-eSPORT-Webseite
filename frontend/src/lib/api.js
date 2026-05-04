import axios from "axios";

export const API = `${process.env.REACT_APP_BACKEND_URL}/api`;

export const api = axios.create({
  baseURL: API,
  withCredentials: true,
  headers: { "Content-Type": "application/json" },
});

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
  if (ms == null) return "—";
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  const mil = ms % 1000;
  return `${m}:${String(s).padStart(2, "0")}.${String(mil).padStart(3, "0")}`;
}

export function parseTimeStr(str) {
  // Parse "m:ss.SSS" or "ss.SSS" -> ms
  if (!str) return null;
  const trimmed = String(str).trim();
  const m = trimmed.match(/^(?:(\d+):)?(\d{1,2})\.(\d{1,3})$/);
  if (!m) return null;
  const mins = parseInt(m[1] || "0", 10);
  const secs = parseInt(m[2], 10);
  const mils = parseInt(m[3].padEnd(3, "0"), 10);
  return mins * 60000 + secs * 1000 + mils;
}
