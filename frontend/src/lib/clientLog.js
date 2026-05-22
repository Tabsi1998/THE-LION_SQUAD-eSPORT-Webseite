import { api } from "./api";

const DEDUPE_MS = 30000;
const sentAtByFingerprint = new Map();

function clip(value, limit) {
  if (value == null) return "";
  const text = String(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

function fingerprintFor(payload) {
  return [
    payload.level,
    payload.source,
    payload.screen,
    payload.error_name,
    clip(payload.message, 500),
    clip((payload.stack || "").split("\n")[0], 240),
  ].join("|").toLowerCase();
}

function sendClientLog(payload) {
  const fingerprint = fingerprintFor(payload);
  const now = Date.now();
  const lastSentAt = sentAtByFingerprint.get(fingerprint) || 0;
  if (now - lastSentAt < DEDUPE_MS) return;
  sentAtByFingerprint.set(fingerprint, now);

  api.post("/mobile/client-logs", {
    level: payload.level || "error",
    message: clip(payload.message || "Web client error", 2000),
    source: "web",
    screen: clip(window.location?.pathname || "", 120),
    error_name: clip(payload.error_name || "", 160),
    stack: clip(payload.stack || "", 8000),
    context: {
      href: window.location?.href || "",
      user_agent: navigator.userAgent || "",
    },
    platform: "web",
    device_name: clip(navigator.userAgent || "Browser", 160),
    os_version: clip(navigator.platform || "", 80),
    app_version: process.env.REACT_APP_VERSION || "",
    created_at: new Date().toISOString(),
  }).catch(() => {});
}

export function startWebClientLogging() {
  if (typeof window === "undefined" || window.__tlsWebClientLoggingStarted) return;
  window.__tlsWebClientLoggingStarted = true;

  window.addEventListener("error", (event) => {
    sendClientLog({
      level: "error",
      message: event.message || event.error?.message || "Web runtime error",
      error_name: event.error?.name || "Error",
      stack: event.error?.stack || "",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    sendClientLog({
      level: "error",
      message: reason?.message || String(reason || "Unhandled promise rejection"),
      error_name: reason?.name || "UnhandledRejection",
      stack: reason?.stack || "",
    });
  });
}
