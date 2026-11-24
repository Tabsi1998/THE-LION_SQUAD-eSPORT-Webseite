import { api } from "./api";
import { isAudioProblem } from "./audioSafe";
import { chunkReloadPending, isChunkLoadError } from "./chunkReload";
import { vitalsRoute } from "./vitals";

const DEDUPE_MS = 30000;
const MAX_LOGS_PER_MINUTE = 12;
// Standardmäßig an: Fehler aus dem Browser kommen mit denselben Grenzen wie
// bisher (Deduplizierung, 12 pro Minute, Tokens und E-Mail-Adressen entfernt)
// im Adminbereich an. Nur VITE_CLIENT_LOGGING=false schaltet es ab (#233).
// Fehler-Sammler (#1657): gemeldet wird ohne Anmeldung an /ops/client-errors - nur Fehlerart, Stack ohne Meldungstext,
// die Seite als Vorlage (/u/:slug) und die Version. Der Server bereinigt noch einmal und speichert nur Code-Stellen.
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

// Fehlerart (#1657): nur der Name eines echten Fehlers und nur als Bezeichner - nie freier Text aus einem abgelehnten
// Objekt. Der Server prüft dasselbe noch einmal.
const ERROR_NAME = /^[A-Za-z0-9_.$]{1,60}$/;

function errorName(value) {
  return value instanceof Error && typeof value.name === "string" && ERROR_NAME.test(value.name) ? value.name : "Error";
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

/** Der Stack ohne den Kopf mit Fehlerart und Meldungstext („TypeError: …“, auch mehrzeilig) - darin können Namen stehen.
 *  Chrome und Edge setzen den Kopf vor die erste Zeile „    at …“; Firefox und Safari haben keinen Kopf („name@url“).
 *  Was weder das eine noch das andere ist, geht gar nicht mit. */
function stackWithoutMessage(stack) {
  const text = String(stack || "");
  const firstFrame = text.search(/\n\s*at /);
  if (firstFrame >= 0) return text.slice(firstFrame + 1);
  return text.includes("@") ? text : "";
}

/** Schickt die Meldung; zurück kommt die Kennung der Fehlergruppe unter „Betrieb & Logs → Fehler“ - oder null (nicht
 *  gesendet, gebremst, Fehler beim Senden). */
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

  const reportId = api.post("/ops/client-errors", {
    source: "web",
    error_type: clip(payload.error_name || "Error", 80),
    stack: scrubClientLogText(stackWithoutMessage(payload.stack), 8000),
    route: vitalsRoute(window.location?.pathname || "/"),
    version: clip(import.meta.env.VITE_APP_VERSION || "", 40),
  }).then(({ data } = {}) => (data && typeof data.id === "string" ? data.id : null)).catch(() => null);
  reportIdByFingerprint.set(fingerprint, reportId);
  return reportId;
}

/** Veralteter Baustein nach einem Deploy (#2080): kein Fehler der Website. Lädt die Seite schon neu, wird gar nichts
 *  gemeldet; sonst (zweiter Fehlschlag gleich nach dem Neuladen) höchstens ein Hinweis - die Originalmeldung steht im
 *  Stack. Alles andere bleibt, wie es ist. */
function reportPayload(error, fallbackMessage, fallbackName, stack) {
  // Kein Ton auf dem Gerät oder vom Browser verweigert (#2080): harmlos, die Klang-Stellen bleiben dann still.
  if (isAudioProblem(error)) return null;
  if (isChunkLoadError(error)) {
    if (chunkReloadPending()) return null;
    // Als eigene Fehlerart, damit er nicht mit echten Fehlern zusammenfällt; die Adresse des Bausteins bleibt im Stack.
    return {
      level: "info",
      message: "",
      error_name: "ChunkLoadError",
      stack: `${error?.message || error}\n${stack}`,
    };
  }
  return { level: "error", message: error?.message || fallbackMessage, error_name: errorName(error), stack };
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
    if (isAudioProblem(event.error || event.message)) return;
    // Die Meldung des Fehlers selbst (nicht „Uncaught …“ des Ereignisses) - nur so fällt ihre Zeile aus dem Stack.
    sendClientLog({
      level: "error",
      message: event.error?.message || event.message || "Web runtime error",
      error_name: errorName(event.error),
      stack: event.error?.stack || "",
    });
  });

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason;
    const payload = reportPayload(reason, String(reason || "Unhandled promise rejection"), "UnhandledRejection", reason?.stack || "");
    if (payload) sendClientLog(payload);
  });
}
