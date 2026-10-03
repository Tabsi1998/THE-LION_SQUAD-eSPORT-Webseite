import { api } from "@/lib/api";

// Ostereiersuche (#646): die Abfragen an den Server und eine kleine Meldung „Fortschritt“, damit Widget, Seite und
// Eier dieselbe Zahl zeigen, ohne nachzufragen.

const listeners = new Set();

export function onHuntProgress(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function emitHuntProgress(progress) {
  listeners.forEach((listener) => {
    try {
      listener(progress);
    } catch {
      // ein kaputter Zuhörer hält die anderen nicht auf
    }
  });
}

// Läuft die Suche wirklich (ein freigegebenes Jahr, nicht nur das Zeitfenster)? Die Eier fragen den Server; die
// Oster-Deko hört zu und legt dann keine Eier in ihre Reihe - zum Verwechseln ähnliche, die man nicht sammeln kann.
let huntActive = null;
const activeListeners = new Set();

export function reportHuntActive(active) {
  huntActive = Boolean(active);
  activeListeners.forEach((listener) => {
    try {
      listener(huntActive);
    } catch {
      // ein kaputter Zuhörer hält die anderen nicht auf
    }
  });
}

/** Zuhören (mit dem letzten Stand, wenn es schon einen gibt); gibt eine Funktion zum Abmelden zurück. */
export function onHuntActive(listener) {
  activeListeners.add(listener);
  if (huntActive !== null) listener(huntActive);
  return () => activeListeners.delete(listener);
}

/** Nur für Tests: wieder „unbekannt“. */
export function resetHuntActive() {
  huntActive = null;
}

/** Die Eier einer Seite; mit `preview` (Token aus dem Admin) die Vorschau: Eier des Jahres zum Ansehen, ohne Schlüssel. */
export async function fetchEggs(route, preview = null) {
  const params = preview ? { route, channel: "web", preview } : { route, channel: "web" };
  const { data } = await api.get("/seasonal/easter/eggs", { params, skipInvalidation: true });
  return data || { active: false, eggs: [] };
}

export async function findEgg(token) {
  const { data } = await api.post("/seasonal/easter/find", { token });
  return data;
}

export async function fetchBasket() {
  const { data } = await api.get("/seasonal/easter/me", { skipInvalidation: true });
  return data;
}

export async function fetchHuntPage() {
  const { data } = await api.get("/seasonal/easter/page", { skipInvalidation: true });
  return data;
}
