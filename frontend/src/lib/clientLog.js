import { api } from "./api";
import { chunkReloadPending, isChunkLoadError } from "./chunkReload";

const DEDUPE_MS = 30000;
const MAX_LOGS_PER_MINUTE = 12;
// Standardmäßig an: Fehler aus dem Browser kommen mit denselben Grenzen wie
// bisher (Deduplizierung, 12 pro Minute, Tokens und E-Mail-Adressen entfernt)
// im Adminbereich an. Nur VITE_CLIENT_LOGGING=false schaltet es ab (#233).
const CLIENT_LOGGING_ENABLED = import.meta.env.VITE_CLIENT_LOGGING !== "false";
const sentAtByFingerprint = new Map();
// Die Kennung der Meldung je Fingerabdruck (#1230): ein zweiter gleicher Fehler innerhalb der Sperrfrist zeigt
// dieselbe Kennung wie der erste - unter „Betrieb & Logs“ ist es auch derselbe Eintrag.
const reportIdByFingerprint = new Map();
let recentSendTimes = [];

function clip(value, limit) {
  if (value == null) return "";
  const text = String(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

export function scrubClientLogText(value, limit) {
  const safe = String(value ?? "")
    .replace(/https?:\/\/[^\s)]+/gi, (url) => url.split(/[?#]/, 1)[0])
    .replace(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, "Bearer [redacted]")
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

/** Schickt die Meldung; zurück kommt die Kennung des Eintrags unter „Betrieb & Logs“ - oder null (nicht gesendet,
 *  ohne Anmeldung, Fehler beim Senden). */
function sendClientLog(payload) {
  if (!CLIENT_LOGGING_ENABLED) return Promise.resolve(null);
  const fingerprint = fingerprintFor(payload);
  const now = Date.now();
  const lastSentAt = sentAtByFingerprint.get(fingerprint) || 0;
  if (now - lastSentAt < DEDUPE_MS) return reportIdByFingerprint.get(fingerprint) || Promise.resolve(null);
  recentSendTimes = recentSendTimes.filter((sentAt) => now - sentAt < 60000);
  if (recentSendTimes.length >= MAX_LOGS_PER_MINUTE) return Promise.resolve(null);
  sentAtByFingerprint.set(fingerprint, now);
  recentSendTimes.push(now);

  const reportId = api.post("/mobile/client-logs", {
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
    app_version: import.meta.env.VITE_APP_VERSION || "",
    created_at: new Date().toISOString(),
  }).then(({ data } = {}) => (data && typeof data.id === "string" ? data.id : null)).catch(() => null);
  reportIdByFingerprint.set(fingerprint, reportId);
  return reportId;
}

/** Veralteter Baustein nach einem Deploy (#2080): kein Fehler der Website. Lädt die Seite schon neu, wird gar nichts
 *  gemeldet; sonst (zweiter Fehlschlag gleich nach dem Neuladen) höchstens ein Hinweis - die Originalmeldung steht im
 *  Stack. Alles andere bleibt, wie es ist. */
function reportPayload(error, fallbackMessage, fallbackName, stack) {
  if (isChunkLoadError(error)) {
    if (chunkReloadPending()) return null;
    return {
      level: "info",
      message: "Veralteter Stand nach Update – automatisches Neuladen half nicht, Hinweis zum Neuladen gezeigt",
      error_name: error?.name || fallbackName,
      stack: `${error?.message || error}\n${stack}`,
    };
  }
  return { level: "error", message: error?.message || fallbackMessage, error_name: error?.name || fallbackName, stack };
}

/** Ein Fehler, den eine Fehlergrenze gefangen hat (#944) - der Browser meldet ihn nicht mehr von selbst.
 *  Liefert die Kennung der Meldung (#1230), damit Admins sie auf der Fehlerseite sehen und weitergeben können. */
export function reportCaughtError(error, componentStack = "") {
  const payload = reportPayload(error, "Seite konnte nicht angezeigt werden", "Error", `${error?.stack || ""}\n${componentStack || ""}`);
  return payload ? sendClientLog(payload) : Promise.resolve(null);
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
    const payload = reportPayload(reason, String(reason || "Unhandled promise rejection"), "UnhandledRejection", reason?.stack || "");
    if (payload) sendClientLog(payload);
  });
}
