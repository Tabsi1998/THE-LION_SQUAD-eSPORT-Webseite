import { useCallback, useEffect, useSyncExternalStore } from "react";

// Das Handy-Menü bleibt offen, wenn der Seitenrahmen wechselt (#1324): beim Laden einer Seite steht erst der Rahmen
// des Seitenwechsels, dann der der Seite - beide teilen sich diesen Zustand. Er gilt nur für die Adresse, auf der das
// Menü geöffnet wurde; ein Wechsel der Seite schließt es wie bisher.

let state = { open: false, path: "" };
const listeners = new Set();

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useMobileMenu(pathname) {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  const open = snapshot.open && snapshot.path === pathname;
  const setOpen = useCallback((next) => {
    const current = state.open && state.path === pathname;
    const value = typeof next === "function" ? next(current) : next;
    state = { open: Boolean(value), path: pathname };
    listeners.forEach((listener) => listener());
  }, [pathname]);
  // Andere Seite: das Menü der alten Seite ist zu - auch beim Zurückkehren dorthin.
  useEffect(() => {
    if (state.open && state.path !== pathname) {
      state = { open: false, path: pathname };
      listeners.forEach((listener) => listener());
    }
  }, [pathname]);
  return [open, setOpen];
}
