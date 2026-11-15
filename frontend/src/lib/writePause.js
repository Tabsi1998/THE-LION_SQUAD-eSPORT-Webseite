import { useSyncExternalStore } from "react";

// Kurze Schreibpause fürs nächtliche Backup (#1009): Der Server antwortet auf Speichern ein paar Sekunden lang mit 503,
// Code „write_pause“ und „Retry-After“. Lesen geht weiter. Der API-Client meldet so eine Antwort hierher; die Leiste
// unter dem Kopf (OfflineBar) sagt „gleich wieder da“ und verschwindet nach der genannten Zeit von selbst. Den Text
// der Antwort zeigt die Seite wie jeden anderen Fehler (formatRequestError) - dort steht, was zu tun ist.

export const WRITE_PAUSE_CODE = "write_pause";
export const WRITE_PAUSE_LABEL = "Kurze Wartung: Wir sichern gerade die Daten. Lesen geht weiter, Speichern ist gleich wieder möglich.";
const DEFAULT_SECONDS = 30;
const MAX_SECONDS = 300;

let state = { active: false, until: 0 };
let timer = null;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Ist das die Antwort der Schreibpause (503 mit Code „write_pause“)? */
export function isWritePauseError(error) {
  return error?.response?.status === 503 && error?.response?.data?.code === WRITE_PAUSE_CODE;
}

/** Sekunden bis zum nächsten Versuch: „Retry-After“, sonst „retry_after“ im Inhalt, sonst 30 - höchstens 5 Minuten. */
export function retryAfterSeconds(error) {
  const headers = error?.response?.headers;
  const raw = (headers && (typeof headers.get === "function" ? headers.get("retry-after") : headers["retry-after"]))
    ?? error?.response?.data?.retry_after;
  const seconds = Number.parseInt(raw, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return DEFAULT_SECONDS;
  return Math.min(seconds, MAX_SECONDS);
}

/** Der Server ist in der Schreibpause - für `seconds` Sekunden die Leiste zeigen (eine längere Meldung gewinnt). */
export function noteWritePause(seconds = DEFAULT_SECONDS, now = Date.now()) {
  const until = Math.max(state.until, now + Math.max(1, seconds) * 1000);
  if (state.active && until === state.until) return;
  state = { active: true, until };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    state = { active: false, until: 0 };
    emit();
  }, until - now);
  emit();
}

export function writePauseSnapshot() {
  return state;
}

export function subscribeWritePause(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useWritePause() {
  return useSyncExternalStore(subscribeWritePause, writePauseSnapshot, writePauseSnapshot);
}

/** Nur für Tests. */
export function resetWritePause() {
  if (timer) clearTimeout(timer);
  timer = null;
  state = { active: false, until: 0 };
  emit();
}
