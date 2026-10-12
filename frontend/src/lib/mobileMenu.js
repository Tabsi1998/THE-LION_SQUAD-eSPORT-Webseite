import { useCallback, useEffect, useSyncExternalStore } from "react";

// Die Menüs im Kopf bleiben offen, wenn der Seitenrahmen wechselt (#1324): beim Laden einer Seite steht erst der Rahmen
// des Seitenwechsels, dann der der Seite - zwei Kopfleisten nacheinander, die sich diesen Zustand teilen. Er gilt nur
// für die Adresse, auf der das Menü geöffnet wurde; ein Wechsel der Seite schließt es wie bisher. Das gilt für das
// Handy-Menü und für das Benutzermenü am PC: ohne den geteilten Zustand ging ein Klick auf den Namen während des Ladens
// verloren - das Menü klappte auf und mit dem Rahmen der Seite wieder zu.

function createFrameMenu() {
  let state = { open: false, path: "" };
  const listeners = new Set();
  const emit = (next) => {
    state = next;
    listeners.forEach((listener) => listener());
  };
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function useFrameMenu(pathname) {
    const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
    const open = snapshot.open && snapshot.path === pathname;
    const setOpen = useCallback((next) => {
      const current = state.open && state.path === pathname;
      const value = typeof next === "function" ? next(current) : next;
      emit({ open: Boolean(value), path: pathname });
    }, [pathname]);
    // Andere Seite: das Menü der alten Seite ist zu - auch beim Zurückkehren dorthin.
    useEffect(() => {
      if (state.open && state.path !== pathname) emit({ open: false, path: pathname });
    }, [pathname]);
    return [open, setOpen];
  }

  const close = () => {
    if (state.open) emit({ open: false, path: state.path });
  };
  return { useFrameMenu, close };
}

const mobileMenu = createFrameMenu();
const userMenu = createFrameMenu();

export function useMobileMenu(pathname) {
  return mobileMenu.useFrameMenu(pathname);
}

export function useUserMenu(pathname) {
  return userMenu.useFrameMenu(pathname);
}

/** Schließt beide Menüs - etwa zwischen Tests, die den Zustand sonst von einem Fall in den nächsten trügen. */
export function closeFrameMenus() {
  mobileMenu.close();
  userMenu.close();
}
