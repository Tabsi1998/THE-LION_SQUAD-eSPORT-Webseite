// Veralteter Baustein nach einem Deploy (#2080): ein offener Tab lädt eine Datei, die es nicht mehr gibt. Statt
// Fehlerseite und Fehler-Log lädt die Seite einmal neu; ein Merker mit Zeitstempel in sessionStorage verhindert,
// dass sie sich im Kreis lädt.
import { readFileSync } from "node:fs";
import path from "node:path";

const STALE = new TypeError("Failed to fetch dynamically imported module: https://lionsquad.at/assets/ReferenceRoundPage-abc123.js");

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

async function freshModule() {
  vi.resetModules();
  return import("./chunkReload");
}

let reload;

beforeEach(() => {
  window.sessionStorage.clear();
  reload = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

test("erkennt Ladefehler von Bausteinen in Chrome, Firefox und Safari - andere Fehler nicht", async () => {
  const { isChunkLoadError } = await freshModule();
  expect(isChunkLoadError(STALE)).toBe(true);
  expect(isChunkLoadError(new TypeError("error loading dynamically imported module: https://x/assets/a.js"))).toBe(true);
  expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
  expect(isChunkLoadError(new Error("Unable to preload CSS for /assets/a.css"))).toBe(true);
  expect(isChunkLoadError(new TypeError("liste.map is not a function"))).toBe(false);
  expect(isChunkLoadError(null)).toBe(false);
});

test("ein Ladefehler lädt die Seite einmal neu, statt einen Fehler zu werfen", async () => {
  const { importWithReload } = await freshModule();
  let settled = false;
  importWithReload(() => Promise.reject(STALE), { reload }).then(() => { settled = true; }, () => { settled = true; });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(settled).toBe(false);
  expect(Number(window.sessionStorage.getItem("tls-chunk-reload-at"))).toBeGreaterThan(0);
});

test("ein zweiter Ladefehler gleich nach dem Neuladen führt zu keiner Schleife", async () => {
  const first = await freshModule();
  first.importWithReload(() => Promise.reject(STALE), { reload });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reload).toHaveBeenCalledTimes(1);

  // Nach dem Neuladen ist das Modul frisch, der Merker in sessionStorage aber noch da.
  const second = await freshModule();
  await expect(second.importWithReload(() => Promise.reject(STALE), { reload })).rejects.toBe(STALE);
  expect(reload).toHaveBeenCalledTimes(1);
});

test("nach Ablauf des Merkers darf ein späteres Update wieder einmal neu laden", async () => {
  const storage = memoryStorage();
  let now = 1_000_000;
  const { requestChunkReload, RELOAD_WINDOW_MS } = await freshModule();
  expect(requestChunkReload({ reload, storage, now: () => now })).toBe(true);
  const later = await freshModule();
  expect(later.requestChunkReload({ reload, storage, now: () => now + 1000 })).toBe(false);
  now += RELOAD_WINDOW_MS + 1;
  const muchLater = await freshModule();
  expect(muchLater.requestChunkReload({ reload, storage, now: () => now })).toBe(true);
  expect(reload).toHaveBeenCalledTimes(2);
});

test("Ereignis und Wrapper zusammen laden nur einmal neu (vite:preloadError und lazy)", async () => {
  const { importWithReload, requestChunkReload, chunkReloadPending } = await freshModule();
  expect(chunkReloadPending()).toBe(false);
  expect(requestChunkReload({ reload })).toBe(true);
  importWithReload(() => Promise.reject(STALE), { reload });
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(reload).toHaveBeenCalledTimes(1);
  expect(chunkReloadPending()).toBe(true);
});

test("andere Fehler und fehlendes Netz laden nicht neu", async () => {
  const { importWithReload, requestChunkReload } = await freshModule();
  const broken = new TypeError("liste.map is not a function");
  await expect(importWithReload(() => Promise.reject(broken), { reload })).rejects.toBe(broken);
  expect(requestChunkReload({ reload, online: () => false })).toBe(false);
  expect(reload).not.toHaveBeenCalled();
});

test("App.jsx lädt jede Seite über lazyPage, keine über das blanke lazy", () => {
  const app = readFileSync(path.resolve(__dirname, "../App.jsx"), "utf8");
  expect(app).not.toMatch(/\blazy\(/);
  expect(app).not.toMatch(/import \{[^}]*\blazy\b[^}]*\} from "react"/);
  expect((app.match(/= lazyPage\(\(\) => import\(/g) || []).length).toBeGreaterThan(100);
});

test("Hintergrund-Bausteine (#936): ein Ladefehler lädt die Seite nicht neu, an ihrer Stelle steht still nichts", async () => {
  const { importOptional, chunkReloadPending } = await freshModule();
  const module = await importOptional(() => Promise.reject(STALE));
  expect(module.default()).toBeNull();
  expect(chunkReloadPending()).toBe(false);
  expect(window.sessionStorage.getItem("tls-chunk-reload-at")).toBeNull();
  // Ein echter Fehler im Baustein geht weiter an die Fehlergrenze.
  const broken = new TypeError("liste.map is not a function");
  await expect(importOptional(() => Promise.reject(broken))).rejects.toBe(broken);
  const loaded = { default: () => "da" };
  await expect(importOptional(() => Promise.resolve(loaded))).resolves.toBe(loaded);
});

test("lazyPage mit optional: Ladefehler zeichnet nichts und lädt nicht neu", async () => {
  const { render, screen, act } = await import("@testing-library/react");
  const { Suspense, createElement: h } = await import("react");
  const { lazyPage, chunkReloadPending } = await freshModule();
  const Part = lazyPage(() => Promise.reject(STALE), { optional: true });
  render(h("div", { "data-testid": "seite" }, h(Suspense, { fallback: h("span", { "data-testid": "laedt" }) }, h(Part))));
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
  expect(screen.getByTestId("seite")).toBeEmptyDOMElement();
  expect(chunkReloadPending()).toBe(false);
});

test("Zeremonie, Glocke, Kronen-Feier und Heute-Karten laden als optionale Hintergrund-Bausteine", () => {
  const read = (file) => readFileSync(path.resolve(__dirname, "..", file), "utf8");
  for (const file of ["components/achievements/ceremony/CeremonySlot.jsx", "components/tls/PublicLayout.jsx", "components/tls/CrownCelebration.jsx", "components/tls/HomeTodayStrip.jsx"]) {
    expect(read(file), file).toMatch(/lazyPage\([\s\S]*?\{ optional: true[ ,}]/);
  }
});

test("ein geladener Baustein kommt unverändert durch", async () => {
  const { importWithReload } = await freshModule();
  const module = { default: () => null };
  await expect(importWithReload(() => Promise.resolve(module), { reload })).resolves.toBe(module);
  expect(reload).not.toHaveBeenCalled();
});
