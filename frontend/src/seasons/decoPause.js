import { useSyncExternalStore } from "react";

// Turniertag (#1169), der kleine Teil im Start-Bundle: ob die Saison-Deko gerade pausiert, weil das eigene Spiel
// aufgerufen ist oder läuft. Bühne, Fußzeile und Konto (SeasonStage, SeasonSlots, SeasonContext) lesen nur hier.
// Was als „eigenes Spiel läuft“ gilt, welche Quelle was meldet und der Sicherheitsablauf (PAUSE_MAX_MS) stehen in
// matchPause.js - das laden nur die Seiten, die eigene Spiele kennen (Startseite, Matchseite, Warteschlange). Die App
// hat beides in mobile/src/seasons/matchPause.ts.

let paused = false;
/** Zählt jedes Abmelden - matchPause.js vergisst damit die Spiele der vorigen Person. */
export let decoPauseGeneration = 0;
const listeners = new Set();

/** Pausiert die Deko gerade? */
export const decoPauseActive = () => paused;

/** Eine Quelle (oder der Wecker des Sicherheitsablaufs) hat gemeldet: pausiert (`true`) oder nicht. */
export function setDecoPause(on) {
  if (paused === Boolean(on)) return;
  paused = Boolean(on);
  listeners.forEach((listener) => listener());
}

/** Abmelden oder ein anderes Konto: die Pause endet, die bekannten eigenen Spiele gelten nicht mehr. */
export function clearDecoPause() {
  decoPauseGeneration += 1;
  setDecoPause(false);
}

export function subscribeDecoPause(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Pausiert das eigene Spiel gerade die Deko? */
export const useDecoPaused = () => useSyncExternalStore(subscribeDecoPause, decoPauseActive, () => false);
