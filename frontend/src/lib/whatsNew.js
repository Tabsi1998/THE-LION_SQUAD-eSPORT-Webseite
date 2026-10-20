// „Neu auf der Website“ (#1240): die letzten Neuerungen in je einem Satz. Die Sätze stehen in `src/whatsnew.json`
// (Datum, Satz, optional ein Link) und werden im Doku-Stand-PR nach einem Merge gepflegt - wie die Texte der App.
// Ein kleiner Punkt am Link in der Fußzeile zeigt, ob seit dem letzten Besuch etwas dazugekommen ist; gemerkt wird das
// im Browser. Ohne Browser-Speicher gibt es einfach keinen Punkt.

export const WHATS_NEW_LIMIT = 30;
export const WHATS_NEW_SEEN_KEY = "tls-whatsnew-seen";
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Gültige Einträge, die neuesten oben (bei gleichem Tag in der Reihenfolge der Datei), höchstens 30. */
export function whatsNewItems(data) {
  const raw = Array.isArray(data) ? data : Array.isArray(data?.items) ? data.items : [];
  return raw
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item && DAY_RE.test(String(item.date || "")) && String(item.text || "").trim())
    .sort((a, b) => (a.item.date === b.item.date ? a.index - b.index : a.item.date < b.item.date ? 1 : -1))
    .slice(0, WHATS_NEW_LIMIT)
    .map(({ item }) => ({ date: item.date, text: String(item.text).trim(), link: safeLink(item.link) }));
}

function safeLink(value) {
  const link = String(value || "").trim();
  // Nur Adressen der eigenen Website - kein fremder Link aus der Datei.
  return link.startsWith("/") && !link.startsWith("//") ? link : null;
}

/** Der Stand, den ein Besucher gesehen hat: der neueste Tag und wie viele Einträge an diesem Tag stehen. */
export function newestMark(items) {
  const newest = items[0]?.date;
  if (!newest) return null;
  return { date: newest, count: items.filter((item) => item.date === newest).length };
}

/** Ist seit `seen` etwas dazugekommen? Ein neuerer Tag oder mehr Einträge am selben Tag. */
export function hasNewSince(items, seen) {
  const mark = newestMark(items);
  if (!mark || !seen || !DAY_RE.test(String(seen.date || ""))) return false;
  if (mark.date !== seen.date) return mark.date > seen.date;
  return mark.count > (Number(seen.count) || 0);
}

function storage(win) {
  try {
    return win?.localStorage || null;
  } catch {
    return null;
  }
}

function readSeen(win) {
  const store = storage(win);
  if (!store) return undefined;
  try {
    const raw = store.getItem(WHATS_NEW_SEEN_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return undefined;
  }
}

function writeSeen(win, mark) {
  const store = storage(win);
  if (!store || !mark) return;
  try {
    store.setItem(WHATS_NEW_SEEN_KEY, JSON.stringify(mark));
  } catch {
    // ohne Speicher bleibt es beim Stand dieses Besuchs
  }
}

/**
 * Soll der Punkt leuchten? Beim allerersten Besuch nicht - dann merkt sich die Seite den heutigen Stand, damit erst
 * später Dazugekommenes zählt. Ohne Browser-Speicher nie.
 */
export function shouldShowDot(items, win = typeof window === "undefined" ? null : window) {
  const seen = readSeen(win);
  if (seen === undefined) return false;
  if (seen === null) {
    writeSeen(win, newestMark(items));
    return false;
  }
  return hasNewSince(items, seen);
}

/** Beim Öffnen von /neu: alles gesehen, der Punkt verschwindet. */
export function markWhatsNewSeen(items, win = typeof window === "undefined" ? null : window) {
  writeSeen(win, newestMark(items));
  try {
    win?.dispatchEvent?.(new Event("tls-whatsnew-seen"));
  } catch {
    // ohne Ereignis bleibt der Punkt bis zum nächsten Seitenwechsel
  }
}
