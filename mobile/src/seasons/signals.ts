import * as SecureStore from "expo-secure-store";

// Signale an die Erfolge (#616, #678) aus der App: was jemand in einer Saison sammelt - Kürbis angetippt, Fledermaus
// verscheucht, Geist befreit, Katze angestupst. Dieselben Regeln wie im Web (frontend/src/seasons/signals.js): die App
// zählt je Tag in Wien und legt jede Zählung in einen Ausgang; wer angemeldet ist, meldet ihn an den Server
// (SignalSync.tsx), wer es nicht ist (Gast), meldet nach dem Login nach - höchstens eine Woche zurück. Über Saison und
// Tagesdeckel entscheidet der Server.
//
// Der sichere Speicher der App ist klein (rund 2 kB je Eintrag). Der Ausgang bleibt deshalb kurz: Signal, Tag, Anzahl -
// und einmal, wem er gehört. Meldet sich eine andere Person an, beginnt er leer: niemand bekommt fremde Funde.

const KEY = "season_signals";
export const OUTBOX_KEY = "season_signal_outbox";
/** So viele Tage zurück nimmt der Server Nachmeldungen an. */
export const REPLAY_DAYS = 7;
/** Höchstens so viele Zeilen je Meldung und so viel je Zeile - die Grenzen des Servers. */
export const MAX_ITEMS = 40;
export const MAX_COUNT = 200;
/** Der Ausgang bleibt klein genug für den sicheren Speicher. */
export const MAX_OUTBOX = 24;

export type PendingSignal = { name: string; day: string; count: number };
type Outbox = { owner: string | null; items: Record<string, number> };
type Listener = (detail: { name: string; count: number }) => void;

let owner: string | null = null;
const listeners = new Set<Listener>();
// Alle Zugriffe auf den Speicher laufen nacheinander - zwei schnelle Tipper überschreiben einander nicht.
let queue: Promise<unknown> = Promise.resolve();

function inOrder<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  queue = next.catch(() => undefined);
  return next;
}

/** Wer gerade angemeldet ist (oder niemand, auch Gäste) - neue Zählungen gehören dieser Person. */
export function setSignalOwner(userId: string | null | undefined): void {
  owner = userId ? String(userId) : null;
}

/** Hört mit, wenn gezählt wurde (für den Abgleich). Gibt die Funktion zum Abmelden zurück. */
export function onSignal(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Der Tag in Wien als JJJJ-MM-TT - so zählt auch der Server. Ohne Zeitzonen-Daten gerechnet: die Sommerzeit gilt in
 * der EU vom letzten Sonntag im März bis zum letzten Sonntag im Oktober, Wechsel jeweils um 01:00 UTC.
 */
export function viennaDay(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const lastSunday = (month: number) => {
    const day = new Date(Date.UTC(year, month + 1, 0, 1, 0, 0));
    day.setUTCDate(day.getUTCDate() - day.getUTCDay());
    return day.getTime();
  };
  const summer = date.getTime() >= lastSunday(2) && date.getTime() < lastSunday(9);
  return new Date(date.getTime() + (summer ? 2 : 1) * 3600000).toISOString().slice(0, 10);
}

function daysBetween(day: string, today: string): number {
  const a = Date.parse(`${day}T00:00:00Z`);
  const b = Date.parse(`${today}T00:00:00Z`);
  return Number.isFinite(a) && Number.isFinite(b) ? Math.round((b - a) / 86400000) : Number.NaN;
}

async function readJson(key: string): Promise<Record<string, unknown>> {
  try {
    const raw = await SecureStore.getItemAsync(key);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJson(key: string, value: unknown): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(key, JSON.stringify(value));
    return true;
  } catch {
    // Ohne Speicher zählt das Signal für diese Sitzung.
    return false;
  }
}

/** Der Ausgang ohne das, was der Server nicht mehr annähme (älter als eine Woche, aus der Zukunft, kaputt). */
async function freshOutbox(now: Date): Promise<Outbox> {
  const stored = await readJson(OUTBOX_KEY);
  const today = viennaDay(now);
  const items: Record<string, number> = {};
  Object.entries((stored.items && typeof stored.items === "object" ? stored.items : {}) as Record<string, unknown>).forEach(([key, value]) => {
    const [name, day] = key.split("|");
    const count = Math.floor(Number(value));
    const age = daysBetween(day, today);
    if (!name || !(count > 0) || !(age >= 0) || age > REPLAY_DAYS) return;
    items[key] = count;
  });
  return { owner: typeof stored.owner === "string" && stored.owner ? stored.owner : null, items };
}

async function addToOutbox(name: string, day: string, now: Date): Promise<void> {
  const outbox = await freshOutbox(now);
  // Gehört der Ausgang einer anderen Person, beginnt er neu; ohne Anmeldung Gesammeltes übernimmt, wer sich anmeldet.
  if (owner && outbox.owner && outbox.owner !== owner) outbox.items = {};
  if (owner) outbox.owner = owner;
  const key = `${name}|${day}`;
  outbox.items[key] = (outbox.items[key] || 0) + 1;
  const keys = Object.keys(outbox.items);
  if (keys.length > MAX_OUTBOX) {
    keys.sort((a, b) => a.split("|")[1].localeCompare(b.split("|")[1])).slice(0, keys.length - MAX_OUTBOX).forEach((old) => delete outbox.items[old]);
  }
  await writeJson(OUTBOX_KEY, outbox);
}

/** true, wenn das Signal gezählt wurde - mit `onceIf` (Vorgabe) nur beim ersten Mal am Tag. */
export function recordSignal(name: string, { onceIf = true, now = new Date() }: { onceIf?: boolean; now?: Date } = {}): Promise<boolean> {
  return inOrder(async () => {
    if (!name) return false;
    const store = (await readJson(KEY)) as Record<string, number>;
    const day = viennaDay(now);
    const key = `${name}:${day}`;
    if (onceIf && store[key]) return false;
    const count = (Number(store[key]) || 0) + 1;
    // Nur heute und gestern merken - der Rest hat seinen Dienst getan, und der sichere Speicher ist klein.
    const kept: Record<string, number> = {};
    Object.entries(store).forEach(([old, value]) => {
      const age = daysBetween(old.slice(old.lastIndexOf(":") + 1), day);
      if (age >= 0 && age <= 1) kept[old] = Number(value) || 0;
    });
    kept[key] = count;
    await writeJson(KEY, kept);
    await addToOutbox(name, day, now);
    listeners.forEach((listener) => {
      try {
        listener({ name, count });
      } catch {
        // Ein Zuhörer, der stolpert, hält das Zählen nicht auf.
      }
    });
    return true;
  });
}

export async function signalCount(name: string, now: Date = new Date()): Promise<number> {
  const store = (await readJson(KEY)) as Record<string, number>;
  return Number(store[`${name}:${viennaDay(now)}`]) || 0;
}

/**
 * Was diese Person jetzt melden kann: ihr eigener Ausgang oder einer, der ohne Anmeldung entstand - je Signal und Tag
 * eine Zeile, höchstens `MAX_ITEMS`, je Zeile höchstens `MAX_COUNT` (der Rest bleibt für die nächste Meldung).
 */
export function pendingSignals(userId: string | null | undefined, now: Date = new Date()): Promise<PendingSignal[]> {
  return inOrder(async () => {
    if (!userId) return [];
    const outbox = await freshOutbox(now);
    if (outbox.owner && outbox.owner !== String(userId)) return [];
    return Object.entries(outbox.items)
      .map(([key, count]) => ({ name: key.split("|")[0], day: key.split("|")[1], count: Math.min(MAX_COUNT, count) }))
      .sort((a, b) => a.day.localeCompare(b.day) || a.name.localeCompare(b.name))
      .slice(0, MAX_ITEMS);
  });
}

/** Nach einer Meldung, die der Server angenommen oder abgelehnt hat: das Gemeldete aus dem Ausgang nehmen. */
export function settleSignals(sent: PendingSignal[], now: Date = new Date()): Promise<number> {
  return inOrder(async () => {
    const outbox = await freshOutbox(now);
    sent.forEach((row) => {
      const key = `${row.name}|${row.day}`;
      if (!outbox.items[key]) return;
      outbox.items[key] -= Math.max(0, Math.floor(Number(row.count)) || 0);
      if (outbox.items[key] <= 0) delete outbox.items[key];
    });
    if (!Object.keys(outbox.items).length) outbox.owner = null;
    await writeJson(OUTBOX_KEY, outbox);
    return Object.keys(outbox.items).length;
  });
}

/** Wie viel im Ausgang liegt - für Tests. */
export async function outboxSize(now: Date = new Date()): Promise<number> {
  const outbox = await freshOutbox(now);
  return Object.values(outbox.items).reduce((sum, count) => sum + count, 0);
}
