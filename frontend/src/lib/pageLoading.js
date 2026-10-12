import { useEffect, useSyncExternalStore } from "react";

// Lädt gerade eine Seite? (#1324) Jedes Skelett und der Seitenwechsel melden sich hier an; der Kopf zeigt solange die
// dünne cyane Linie. Ein Zähler, kein Zustand pro Seite - zwei Skelette gleichzeitig sind ein Laden.

let count = 0;
const listeners = new Set();

function emit() {
  listeners.forEach((listener) => listener());
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Meldet ein Laden an; die zurückgegebene Funktion meldet es (einmal) wieder ab. */
export function startPageLoading() {
  count += 1;
  emit();
  let done = false;
  return () => {
    if (done) return;
    done = true;
    count = Math.max(0, count - 1);
    emit();
  };
}

/** Solange die Komponente steht (und `active` ist), lädt die Seite. */
export function usePageLoadingMark(active = true) {
  useEffect(() => (active ? startPageLoading() : undefined), [active]);
}

/** true, solange irgendwo etwas lädt. */
export function usePageLoading() {
  return useSyncExternalStore(subscribe, () => count > 0, () => false);
}
