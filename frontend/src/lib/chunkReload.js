import { lazy } from "react";

// Veralteter Baustein nach einem Deploy (#2080): Ein Tab, der vor dem Update offen war, kennt noch die alten
// Dateinamen (etwa ReferenceRoundPage-abc123.js); die gibt es nach dem Deploy nicht mehr. Statt Fehlerseite und
// Fehler-Log lädt die Seite dann einmal neu und holt den neuen Stand. Der Merker mit Zeitstempel in sessionStorage
// verhindert eine Schleife: Schlägt es gleich nach dem Neuladen wieder fehl, bleibt es bei der Fehlerseite bzw. dem
// Hinweis „Neu laden“. Ein späteres Update (nach RELOAD_WINDOW_MS) darf wieder einmal neu laden.
// Zusammenspiel: `vite:preloadError` (index.jsx) und der Wrapper um die Lazy-Seiten (App.jsx) fragen beide hier -
// wer zuerst kommt, lädt neu, der andere wartet mit; geladen wird je Seitenleben höchstens einmal.

export const RELOAD_STORAGE_KEY = "tls-chunk-reload-at";
export const RELOAD_WINDOW_MS = 60_000;

const CHUNK_ERROR = /Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Unable to preload CSS|ChunkLoadError|Loading (?:CSS )?chunk [\w-]+ failed/i;

let reloadPending = false;

export function isChunkLoadError(error) {
  if (!error) return false;
  return CHUNK_ERROR.test(`${error.name || ""} ${error.message || error}`);
}

/** Läuft das einmalige Neuladen schon? Dann melden Fehler-Reporter einen veralteten Baustein gar nicht erst. */
export function chunkReloadPending() {
  return reloadPending;
}

function defaultStorage() {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function readMarker(storage) {
  try {
    return Number(storage?.getItem(RELOAD_STORAGE_KEY)) || 0;
  } catch {
    return 0;
  }
}

function writeMarker(storage, value) {
  try {
    storage?.setItem(RELOAD_STORAGE_KEY, String(value));
    return true;
  } catch {
    return false;
  }
}

/** Einmal neu laden, wenn das erlaubt ist. true: lädt (oder lädt schon) neu - false: nicht (Merker frisch, offline,
 *  kein sessionStorage). Ohne Merker kein Neuladen - sonst gäbe es keinen Schutz vor der Schleife. */
export function requestChunkReload({
  storage = defaultStorage(),
  reload = () => window.location.reload(),
  now = Date.now,
  online = () => typeof navigator === "undefined" || navigator.onLine !== false,
} = {}) {
  if (reloadPending) return true;
  if (!online()) return false;
  const current = now();
  const last = readMarker(storage);
  if (last && current - last >= 0 && current - last < RELOAD_WINDOW_MS) return false;
  if (!writeMarker(storage, current)) return false;
  reloadPending = true;
  reload();
  return true;
}

/** Ein dynamischer Import, der bei einem veralteten Baustein einmal neu lädt; bis dahin bleibt er offen (Suspense
 *  zeigt weiter den Ladezustand). Jeder andere Fehler - und der zweite Ladefehler - geht unverändert weiter. */
export function importWithReload(factory, options) {
  return factory().catch((error) => {
    if (isChunkLoadError(error) && requestChunkReload(options)) return new Promise(() => {});
    throw error;
  });
}

/** `lazy()` für Seiten: wie React.lazy, aber mit einmaligem Neuladen nach einem Deploy. */
export function lazyPage(factory) {
  return lazy(() => importWithReload(factory));
}
