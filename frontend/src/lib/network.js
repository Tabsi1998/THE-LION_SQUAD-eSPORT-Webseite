import { useSyncExternalStore } from "react";
import { viennaTime } from "@/lib/vienna";

// Netz der Website (#1152, wie mobile/src/lib/network.ts): Der Browser meldet „offline“ und „online“; der API-Client
// meldet jede echte Antwort (dann ist das Netz da, und die Uhrzeit ist der Stand der gezeigten Daten) und jeden Abruf,
// der ohne Antwort scheitert. Die Leiste „Offline · Stand 14:05“ liest von hier - offene Seiten behalten ihren Inhalt.

let state = { offline: false, stand: null };
let lastFresh = null;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function set(next) {
  if (next.offline === state.offline && next.stand === state.stand) return;
  state = next;
  emit();
}

/** Eine echte Antwort vom Server: das Netz ist da. */
export function noteFresh(at = Date.now()) {
  lastFresh = at;
  if (state.offline && (typeof navigator === "undefined" || navigator.onLine !== false)) set({ offline: false, stand: null });
}

/** Kein Netz (Browser meldet offline, oder ein Abruf kam ohne Antwort zurück). */
export function noteOffline() {
  set({ offline: true, stand: state.offline ? state.stand : lastFresh });
}

export function networkSnapshot() {
  return state;
}

export function subscribeNetwork(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNetwork() {
  return useSyncExternalStore(subscribeNetwork, networkSnapshot, networkSnapshot);
}

/** „Offline · Stand 14:05“ - ohne bekannten Stand nur „Offline“. */
export function offlineLabel(stand) {
  if (!stand) return "Offline";
  return `Offline · Stand ${viennaTime(stand, { hour: "2-digit", minute: "2-digit" })}`;
}

/** Hört auf den Browser: `offline` und `online`. Einmal beim Start (main.jsx / Layout). */
export function watchBrowserNetwork(win = typeof window === "undefined" ? null : window) {
  if (!win || typeof win.addEventListener !== "function") return () => {};
  const goOffline = () => noteOffline();
  const goOnline = () => set({ offline: false, stand: null });
  win.addEventListener("offline", goOffline);
  win.addEventListener("online", goOnline);
  if (win.navigator && win.navigator.onLine === false) noteOffline();
  return () => {
    win.removeEventListener("offline", goOffline);
    win.removeEventListener("online", goOnline);
  };
}

/** Nur für Tests. */
export function resetNetwork() {
  lastFresh = null;
  state = { offline: false, stand: null };
  emit();
}
