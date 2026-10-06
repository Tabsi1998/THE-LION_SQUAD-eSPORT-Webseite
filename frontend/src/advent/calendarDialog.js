import { useSyncExternalStore } from "react";

// Ob der Adventkalender gerade als Fenster über der Seite offen ist (#963): ein Wert für alle Einstiege - das Türchen
// neben dem Logo, der Eintrag im Handy-Menü, der Hinweis im Dashboard und die alte Adresse /advent. Kein Kontext,
// damit jeder Einstieg ihn ohne Umweg setzen kann; das Fenster selbst hängt an der Bühne der Saison.

/** Schlüssel im Verlauf-Zustand: so öffnet die Umleitung von /advent das Fenster auf der Startseite. */
export const OPEN_STATE_KEY = "openAdventCalendar";

let open = false;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function openAdventCalendar() {
  if (open) return;
  open = true;
  emit();
}

export function closeAdventCalendar() {
  if (!open) return;
  open = false;
  emit();
}

export function isAdventCalendarOpen() {
  return open;
}

export function useAdventCalendarOpen() {
  return useSyncExternalStore(subscribe, isAdventCalendarOpen, () => false);
}
