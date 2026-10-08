import { useSyncExternalStore } from "react";
import { API_URL } from "../config";
import { viennaTime } from "./vienna";

// Netz der App (#1152): Der API-Client meldet jede Antwort. Eine echte Antwort heißt „online“ und merkt sich die
// Uhrzeit; ein Netzwerkfehler oder eine Antwort aus dem Zwischenspeicher heißt „offline“ - mit dem Stand der gezeigten
// Daten (der älteste Stand, der gerade aus dem Speicher kommt, sonst die letzte echte Antwort). Ohne Netz fragt die App
// alle 15 Sekunden leise nach, ob es wieder da ist; die Leiste „Offline · Stand 14:05“ verschwindet dann von selbst.

export type NetworkState = { offline: boolean; stand: number | null };

/** So oft fragt die App ohne Netz nach, ob es wieder da ist (ms). */
export const RECOVERY_MS = 15000;

let state: NetworkState = { offline: false, stand: null };
let lastFresh: number | null = null;
let recovery: ReturnType<typeof setInterval> | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

function stopRecovery() {
  if (recovery) clearInterval(recovery);
  recovery = null;
}

function startRecovery() {
  if (recovery || typeof fetch !== "function") return;
  recovery = setInterval(() => {
    fetch(`${API_URL}/health/live`, { method: "GET" })
      .then((response) => {
        if (response && response.ok) noteFresh();
      })
      .catch(() => undefined);
  }, RECOVERY_MS);
}

/** Eine echte Antwort vom Server: online, der Stand ist jetzt. */
export function noteFresh(at: number = Date.now()) {
  lastFresh = at;
  stopRecovery();
  if (!state.offline) return;
  state = { offline: false, stand: null };
  emit();
}

/** Kein Netz: `cachedAt` ist die Zeit der Daten aus dem Zwischenspeicher (falls es welche gab). */
export function noteOffline(cachedAt: number | null = null) {
  const candidate = cachedAt ?? lastFresh;
  const stand = state.offline && state.stand !== null && candidate !== null ? Math.min(state.stand, candidate) : state.stand ?? candidate;
  const changed = !state.offline || stand !== state.stand;
  state = { offline: true, stand };
  startRecovery();
  if (changed) emit();
}

export function networkSnapshot(): NetworkState {
  return state;
}

export function subscribeNetwork(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Der Netz-Zustand für Komponenten (die Offline-Leiste). */
export function useNetwork(): NetworkState {
  return useSyncExternalStore(subscribeNetwork, networkSnapshot, networkSnapshot);
}

/** „Offline · Stand 14:05“ - ohne bekannten Stand nur „Offline“. */
export function offlineLabel(stand: number | null): string {
  if (!stand) return "Offline";
  return `Offline · Stand ${viennaTime(stand, { hour: "2-digit", minute: "2-digit" })}`;
}

/** Nur für Tests. */
export function resetNetwork() {
  stopRecovery();
  lastFresh = null;
  state = { offline: false, stand: null };
  emit();
}
