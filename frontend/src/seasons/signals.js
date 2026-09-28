// Signale an die Erfolge (#616): Kürbis angeklickt, Schneeflocken, Silvester online. Bis der Zähler-
// Dienst der Erfolge II da ist, merkt sich der Browser das Signal nur je Tag - nichts geht verloren,
// nichts wird doppelt gezählt, und der Aufruf bleibt an einer Stelle.

const STORAGE_KEY = "tls-season-signals";

function today() {
  return new Date().toISOString().slice(0, 10);
}

function readStore() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** true, wenn das Signal heute zum ersten Mal kam. */
export function recordSignal(name, { onceIf = true } = {}) {
  if (!name) return false;
  const store = readStore();
  const key = `${name}:${today()}`;
  if (onceIf && store[key]) return false;
  store[key] = (store[key] || 0) + 1;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // Ohne localStorage bleibt das Signal ein Ereignis für diese Seite.
  }
  try {
    window.dispatchEvent(new CustomEvent("tls:season-signal", { detail: { name, count: store[key] } }));
  } catch {
    // Kein CustomEvent (alte Umgebung): nichts zu tun.
  }
  return true;
}

export function signalCount(name) {
  return readStore()[`${name}:${today()}`] || 0;
}
