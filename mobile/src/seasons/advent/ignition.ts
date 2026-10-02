import * as SecureStore from "expo-secure-store";

// Anzünden in der App (S6, #637; W1, #727; S11, #642): am Adventsonntag, an dem eine Kerze dazukommt, brennt sie
// beim ersten Aufruf des Tages sichtbar an - Streichholz-Schein, die Flamme fängt, dann eine ruhige Phase. Nur an
// diesem Tag und nur einmal je Kerze (sicherer Speicher des Geräts); wer erst am Montag kommt, sieht die Kerze
// einfach brennen. Wie im Web (frontend/src/seasons/advent/ignition.js), nur mit dem Speicher der App.

export const STORAGE_KEY = "advent_lit";
/** Wie lange das Anzünden dauert (Schein und Fangen) und wie lange die Flamme danach ruhig brennt. */
export const LIGHTING_MS = 1500;
export const CALM_MS = 4000;

/** Was schon angezündet wurde: { jahr: { kerze: tag } }. */
export type Lit = Record<string, Record<string, string>>;

export type IgnitionSpec = { year: number; sundays?: string[]; candles?: number; today: string };

function cleanLit(raw: unknown): Lit {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const lit: Lit = {};
  for (const [year, candles] of Object.entries(raw as Record<string, unknown>)) {
    if (!candles || typeof candles !== "object" || Array.isArray(candles)) continue;
    lit[year] = Object.fromEntries(Object.entries(candles as Record<string, unknown>).filter(([, day]) => typeof day === "string").map(([index, day]) => [index, String(day)]));
  }
  return lit;
}

export async function readLit(): Promise<Lit> {
  try {
    const raw = await SecureStore.getItemAsync(STORAGE_KEY);
    return cleanLit(raw ? JSON.parse(raw) : null);
  } catch {
    return {};
  }
}

/**
 * Welche Kerzen heute anzuzünden sind: die, deren Sonntag heute ist, die brennen dürfen (`candles`) und heute noch
 * nicht angezündet wurden - reine Rechnung über dem gelesenen Speicher.
 */
export function dueFrom(lit: Lit, { year, sundays = [], candles = 0, today }: IgnitionSpec): number[] {
  const done = lit[String(year)] || {};
  return sundays
    .map((sunday, index) => ({ sunday, index }))
    .filter(({ sunday, index }) => index < candles && sunday === today && done[String(index)] !== today)
    .map(({ index }) => index);
}

export async function dueIgnitions(spec: IgnitionSpec): Promise<number[]> {
  return dueFrom(await readLit(), spec);
}

/** Merkt sich das Anzünden einer Kerze für heute; ohne Speicher passiert nichts (dann brennt sie beim nächsten Aufruf einfach). */
export async function markIgnited(year: number, index: number, today: string): Promise<void> {
  try {
    const lit = await readLit();
    lit[String(year)] = { ...(lit[String(year)] || {}), [String(index)]: today };
    await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(lit));
  } catch {
    // voller oder gesperrter Speicher: kein Drama, das Anzünden kommt beim nächsten Aufruf noch einmal
  }
}
