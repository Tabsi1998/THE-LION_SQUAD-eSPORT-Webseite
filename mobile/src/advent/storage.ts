import * as SecureStore from "expo-secure-store";
import { DOORS } from "./doors";

// Was ein Gast in der App geöffnet hat, merkt sich nur das Gerät - an den Server geht davon nichts außer der Bitte,
// den Inhalt dieser Türchen noch einmal zu zeigen. Nach dem Anmelden werden die Türchen für das Konto nachgeholt
// (dann zählen sie), und das Gerät vergisst seine Liste. Wie im Web: frontend/src/advent/storage.js.

export const STORAGE_KEY = "advent_opened";

type Stored = { year: number; days: number[] };

function valid(day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= DOORS;
}

async function read(): Promise<Stored | null> {
  try {
    const parsed = JSON.parse((await SecureStore.getItemAsync(STORAGE_KEY)) || "null");
    if (!parsed || !Number.isInteger(Number(parsed.year)) || !Array.isArray(parsed.days)) return null;
    const days = [...new Set<number>(parsed.days.map(Number).filter(valid))].sort((a, b) => a - b);
    return { year: Number(parsed.year), days };
  } catch {
    return null;
  }
}

async function write(year: number, days: number[]): Promise<void> {
  try {
    if (days.length) await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify({ year: Number(year), days }));
    else await SecureStore.deleteItemAsync(STORAGE_KEY);
  } catch {
    // Ohne Speicher bleibt das Türchen nur bis zum nächsten Start offen.
  }
}

/** Das Jahr, zu dem die gemerkten Türchen gehören, und die Türchen selbst - sortiert, ohne Doppelte. */
export async function remembered(): Promise<Stored | null> {
  return read();
}

export async function readOpened(year: number): Promise<number[]> {
  const stored = await read();
  return stored && stored.year === Number(year) ? stored.days : [];
}

export async function rememberOpened(year: number, day: number): Promise<number[]> {
  const current = await readOpened(year);
  if (!valid(Number(day))) return current;
  const days = [...new Set([...current, Number(day)])].sort((a, b) => a - b);
  await write(year, days);
  return days;
}

export async function forgetOpened(year: number, day: number | null = null): Promise<number[]> {
  const days = day === null ? [] : (await readOpened(year)).filter((entry) => entry !== Number(day));
  await write(year, days);
  return days;
}
