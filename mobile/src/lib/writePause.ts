import { useSyncExternalStore } from "react";

// Kurze Schreibpause fürs nächtliche Backup (#1009, App: #2173, Web: frontend/src/lib/writePause.js): Der Server antwortet auf
// Speichern ein paar Sekunden lang mit 503, Code „write_pause“ und „Retry-After“. Lesen geht weiter. Der API-Client meldet so eine
// Antwort hierher; die Leiste oben im Screen sagt „gleich wieder möglich“ und verschwindet nach der genannten Zeit von selbst. Wo
// eine Fehlermeldung steht (`errorMessage`), steht statt „Request failed with status code 503“ derselbe freundliche Satz.

export const WRITE_PAUSE_CODE = "write_pause";
/** Die Leiste oben im Screen - kurz, wie im Web. */
export const WRITE_PAUSE_LABEL = "Kurze Wartung: Wir sichern gerade die Daten. Speichern ist gleich wieder möglich.";
/** Statt der Fehlermeldung: was los ist und was zu tun ist. */
export const WRITE_PAUSE_MESSAGE = "Kurze Wartung: Wir sichern gerade die Daten. Speichern ist gleich wieder möglich – bitte versuch es in einer Minute noch einmal.";
const DEFAULT_SECONDS = 30;
const MAX_SECONDS = 300;

type WritePauseState = { active: boolean; until: number };
type ErrorLike = { response?: { status?: number; data?: unknown; headers?: unknown } } | null | undefined;

let state: WritePauseState = { active: false, until: 0 };
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Ist das die Antwort der Schreibpause (503 mit Code „write_pause“)? Ein anderer 503 bleibt ein gewöhnlicher Fehler. */
export function isWritePauseError(error: unknown): boolean {
  const response = (error as ErrorLike)?.response;
  const data = response?.data as { code?: unknown } | null | undefined;
  return response?.status === 503 && data?.code === WRITE_PAUSE_CODE;
}

function header(headers: unknown, name: string): unknown {
  if (!headers || typeof headers !== "object") return undefined;
  const getter = (headers as { get?: (key: string) => unknown }).get;
  if (typeof getter === "function") {
    const value = getter.call(headers, name);
    if (value !== undefined && value !== null) return value;
  }
  return (headers as Record<string, unknown>)[name];
}

/** Sekunden bis zum nächsten Versuch: „Retry-After“, sonst „retry_after“ im Inhalt, sonst 30 - höchstens 5 Minuten. */
export function retryAfterSeconds(error: unknown): number {
  const response = (error as ErrorLike)?.response;
  const raw = header(response?.headers, "retry-after") ?? (response?.data as { retry_after?: unknown } | null | undefined)?.retry_after;
  const seconds = Number.parseInt(String(raw ?? ""), 10);
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

export function writePauseSnapshot(): WritePauseState {
  return state;
}

export function subscribeWritePause(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useWritePause(): WritePauseState {
  return useSyncExternalStore(subscribeWritePause, writePauseSnapshot, writePauseSnapshot);
}

/** Nur für Tests. */
export function resetWritePause() {
  if (timer) clearTimeout(timer);
  timer = null;
  state = { active: false, until: 0 };
  emit();
}
