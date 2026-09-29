// Anzünden (S6, #637; W1, #727): am Adventsonntag, an dem eine Kerze dazukommt, brennt sie beim ersten Aufruf des
// Tages sichtbar an - Streichholz-Schein, die Flamme fängt, dann eine ruhige Phase. Nur an diesem Tag und nur einmal
// je Kerze (localStorage); wer erst am Montag kommt, sieht die Kerze einfach brennen. Reine Rechnung ohne React.

export const STORAGE_KEY = "tls_advent_lit";
/** Wie lange das Anzünden dauert (Schein und Fangen) und wie lange die Flamme danach ruhig brennt. */
export const LIGHTING_MS = 1500;
export const CALM_MS = 4000;

/** Was schon angezündet wurde: { jahr: { kerze: tag } }. */
export function readLit(storage) {
  try {
    const raw = storage && typeof storage.getItem === "function" ? storage.getItem(STORAGE_KEY) : null;
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/**
 * Welche Kerzen heute anzuzünden sind: die, deren Sonntag heute ist, die brennen dürfen (`candles`) und heute noch
 * nicht angezündet wurden.
 */
export function dueIgnitions({ year, sundays = [], candles = 0, today, storage = null }) {
  const lit = readLit(storage)[String(year)] || {};
  return sundays
    .map((sunday, index) => ({ sunday, index }))
    .filter(({ sunday, index }) => index < candles && sunday === today && lit[String(index)] !== today)
    .map(({ index }) => index);
}

/** Merkt sich das Anzünden einer Kerze für heute; ohne Speicher passiert nichts (dann brennt sie beim nächsten Aufruf einfach). */
export function markIgnited(storage, year, index, today) {
  if (!storage || typeof storage.setItem !== "function") return;
  try {
    const lit = readLit(storage);
    lit[String(year)] = { ...(lit[String(year)] || {}), [String(index)]: today };
    storage.setItem(STORAGE_KEY, JSON.stringify(lit));
  } catch {
    // voller oder gesperrter Speicher: kein Drama, das Anzünden kommt beim nächsten Aufruf noch einmal
  }
}
