// Signale an die Erfolge (#616, #678): was jemand in einer Saison sammelt - Kürbis angeklickt, Fledermaus verscheucht,
// Schneeflocke gefangen. Der Browser zählt je Tag (damit nichts doppelt zählt und Spielereien wie der Schneekönig auch
// ohne Anmeldung gehen) und legt jede Zählung in einen Ausgang. Wer angemeldet ist, meldet den Ausgang an den Server
// (SignalSync.jsx); wer es nicht ist, meldet nach dem Login nach - höchstens eine Woche zurück. Über Saison und
// Tagesdeckel entscheidet der Server.
//
// Im Ausgang steht nur Signal, Tag und Anzahl - und, falls jemand angemeldet war, dessen Kennung, damit am geteilten
// Rechner niemand die Funde eines anderen bekommt. Der Tag ist der Tag in Wien (wie am Server), nicht der des Geräts.

const STORAGE_KEY = "tls-season-signals";
export const OUTBOX_KEY = "tls-season-signal-outbox";
/** So viele Tage zurück nimmt der Server Nachmeldungen an. */
export const REPLAY_DAYS = 7;
/** Höchstens so viele Zeilen je Meldung und so viel je Zeile - die Grenzen des Servers. */
export const MAX_ITEMS = 40;
export const MAX_COUNT = 200;
/** Der Ausgang bleibt klein: ältere Zeilen fallen heraus, wenn er voll ist. */
export const MAX_OUTBOX = 80;
const ANONYMOUS = "-";

let owner = null;

/** Wer gerade angemeldet ist (oder niemand) - neue Zählungen im Ausgang gehören dieser Person. */
export function setSignalOwner(userId) {
  owner = userId ? String(userId) : null;
}

/** Der Tag in Wien als JJJJ-MM-TT - so zählt auch der Server. */
export function viennaDay(date = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
    const pick = (type) => parts.find((part) => part.type === type)?.value;
    const day = `${pick("year")}-${pick("month")}-${pick("day")}`;
    if (/^\d{4}-\d{2}-\d{2}$/.test(day)) return day;
  } catch {
    // Ohne Zeitzonen-Daten bleibt der Tag des Geräts in UTC - der Server prüft den Tag ohnehin.
  }
  return date.toISOString().slice(0, 10);
}

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    // Ohne localStorage bleibt das Signal ein Ereignis für diese Seite.
    return false;
  }
}

function daysBetween(day, today) {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : Number.NaN;
}

function entryKey(who, name, day) {
  return `${who || ANONYMOUS}|${name}|${day}`;
}

function parseKey(key) {
  const [who, name, day] = String(key).split("|");
  return { owner: who && who !== ANONYMOUS ? who : null, name, day };
}

/** Der Ausgang ohne das, was der Server nicht mehr annähme (älter als eine Woche, aus der Zukunft, kaputt). */
function freshOutbox(now = new Date()) {
  const today = viennaDay(now);
  const out = {};
  Object.entries(readJson(OUTBOX_KEY)).forEach(([key, value]) => {
    const { name, day } = parseKey(key);
    const count = Math.floor(Number(value));
    const age = daysBetween(day, today);
    if (!name || !(count > 0) || !(age >= 0) || age > REPLAY_DAYS) return;
    out[key] = count;
  });
  return out;
}

function addToOutbox(name, day, count, now) {
  const outbox = freshOutbox(now);
  const key = entryKey(owner, name, day);
  outbox[key] = (outbox[key] || 0) + count;
  const keys = Object.keys(outbox);
  // Voll: die ältesten Tage zuerst hinaus (der Schlüssel endet mit dem Tag).
  if (keys.length > MAX_OUTBOX) {
    keys.sort((a, b) => parseKey(a).day.localeCompare(parseKey(b).day)).slice(0, keys.length - MAX_OUTBOX).forEach((old) => delete outbox[old]);
  }
  writeJson(OUTBOX_KEY, outbox);
}

/** true, wenn das Signal gezählt wurde - mit `onceIf` nur beim ersten Mal am Tag. */
export function recordSignal(name, { onceIf = true, now = new Date() } = {}) {
  if (!name) return false;
  const store = readJson(STORAGE_KEY);
  const day = viennaDay(now);
  const key = `${name}:${day}`;
  if (onceIf && store[key]) return false;
  store[key] = (store[key] || 0) + 1;
  // Nur heute und gestern merken - der Rest hat seinen Dienst getan.
  Object.keys(store).forEach((old) => {
    const age = daysBetween(old.slice(old.lastIndexOf(":") + 1), day);
    if (!(age >= 0) || age > 1) delete store[old];
  });
  writeJson(STORAGE_KEY, store);
  addToOutbox(name, day, 1, now);
  try {
    window.dispatchEvent(new CustomEvent("tls:season-signal", { detail: { name, count: store[key] } }));
  } catch {
    // Kein CustomEvent (alte Umgebung): nichts zu tun.
  }
  return true;
}

export function signalCount(name, now = new Date()) {
  return readJson(STORAGE_KEY)[`${name}:${viennaDay(now)}`] || 0;
}

/**
 * Was diese Person jetzt melden kann: ihre eigenen Zählungen und die, die ohne Anmeldung entstanden sind - je Signal
 * und Tag eine Zeile, höchstens `MAX_ITEMS`, je Zeile höchstens `MAX_COUNT` (der Rest bleibt für die nächste Meldung).
 */
export function pendingSignals(userId, now = new Date()) {
  if (!userId) return [];
  const mine = String(userId);
  const merged = new Map();
  Object.entries(freshOutbox(now)).forEach(([key, count]) => {
    const entry = parseKey(key);
    if (entry.owner && entry.owner !== mine) return;
    const id = `${entry.name}|${entry.day}`;
    const row = merged.get(id) || { name: entry.name, day: entry.day, count: 0, keys: [] };
    row.count += count;
    row.keys.push([key, count]);
    merged.set(id, row);
  });
  return [...merged.values()]
    .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name))
    .slice(0, MAX_ITEMS)
    .map((row) => ({ ...row, count: Math.min(MAX_COUNT, row.count) }));
}

/** Nach einer Meldung, die der Server angenommen oder abgelehnt hat: das Gemeldete aus dem Ausgang nehmen. */
export function settleSignals(sent = [], now = new Date()) {
  const outbox = freshOutbox(now);
  sent.forEach((row) => {
    let left = Math.max(0, Math.floor(Number(row.count)) || 0);
    (row.keys || []).forEach(([key]) => {
      if (left <= 0 || !outbox[key]) return;
      const take = Math.min(left, outbox[key]);
      outbox[key] -= take;
      left -= take;
      if (outbox[key] <= 0) delete outbox[key];
    });
  });
  writeJson(OUTBOX_KEY, outbox);
  return Object.keys(outbox).length;
}

/** Wie viel im Ausgang liegt (alle Personen) - für Tests und die Anzeige „wird nachgemeldet“. */
export function outboxSize(now = new Date()) {
  return Object.values(freshOutbox(now)).reduce((sum, count) => sum + count, 0);
}
