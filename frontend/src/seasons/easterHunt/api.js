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
