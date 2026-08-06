import { api } from "./api";

const DEDUPE_MS = 30000;
const MAX_LOGS_PER_MINUTE = 12;
const CLIENT_LOGGING_ENABLED = process.env.REACT_APP_CLIENT_LOGGING === "true";
const sentAtByFingerprint = new Map();
let recentSendTimes = [];

function clip(value, limit) {
  if (value == null) return "";
  const text = String(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

export function scrubClientLogText(value, limit) {
  const safe = String(value ?? "")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => url.split(/[?#]/, 1)[0])
    .replace(/\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi, "Bearer [redacted]")
    .replace(/\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g, "[redacted-token]")
    .replace(/([?&](?:access_token|refresh_token|token|code|key|secret|email)=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, "[redacted-email]");
  return clip(safe, limit);
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
  if (!CLIENT_LOGGING_ENABLED) return;
  const fingerprint = fingerprintFor(payload);
  const now = Date.now();
  const lastSentAt = sentAtByFingerprint.get(fingerprint) || 0;
  if (now - lastSentAt < DEDUPE_MS) return;
  recentSendTimes = recentSendTimes.filter((sentAt) => now - sentAt < 60000);
  if (recentSendTimes.length >= MAX_LOGS_PER_MINUTE) return;
  sentAtByFingerprint.set(fingerprint, now);
  recentSendTimes.push(now);

  api.post("/mobile/client-logs", {
    level: payload.level || "error",
    message: scrubClientLogText(payload.message || "Web client error", 2000),
    source: "web",
    screen: clip(window.location?.pathname || "", 120),
    error_name: scrubClientLogText(payload.error_name || "", 160),
    stack: scrubClientLogText(payload.stack || "", 4000),
    context: {
      path: window.location?.pathname || "",
    },
    platform: "web",
    app_version: process.env.REACT_APP_VERSION || "",
    created_at: new Date().toISOString(),
  }).catch(() => {});
}

export function startWebClientLogging() {
  if (!CLIENT_LOGGING_ENABLED || typeof window === "undefined" || window.__tlsWebClientLoggingStarted) return;
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
