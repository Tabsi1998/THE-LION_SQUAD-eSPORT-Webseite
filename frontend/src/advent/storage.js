import { DOORS } from "./doors";

// Was ein Gast geöffnet hat, merkt sich nur sein Browser - an den Server geht davon nichts außer der Bitte,
// den Inhalt dieser Türchen noch einmal zu zeigen. Nach dem Anmelden werden die Türchen für das Konto
// nachgeholt (dann zählen sie), und der Browser vergisst seine Liste.

export const STORAGE_KEY = "tls-advent-opened";

function valid(day) {
  return Number.isInteger(day) && day >= 1 && day <= DOORS;
}

/** Die Türchen, die dieser Browser für das Jahr als geöffnet kennt - sortiert, ohne Doppelte. */
export function readOpened(year) {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!parsed || Number(parsed.year) !== Number(year) || !Array.isArray(parsed.days)) return [];
    return [...new Set(parsed.days.map(Number).filter(valid))].sort((a, b) => a - b);
  } catch {
    return [];
  }
}

function write(year, days) {
  try {
    if (days.length) localStorage.setItem(STORAGE_KEY, JSON.stringify({ year: Number(year), days }));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ohne Speicher bleibt das Türchen nur bis zum Neuladen offen.
  }
}

export function rememberOpened(year, day) {
  if (!valid(Number(day))) return readOpened(year);
  const days = [...new Set([...readOpened(year), Number(day)])].sort((a, b) => a - b);
  write(year, days);
  return days;
}

export function forgetOpened(year, day = null) {
  const days = day === null ? [] : readOpened(year).filter((entry) => entry !== Number(day));
  write(year, days);
  return days;
}

/** Das Jahr, zu dem die gemerkten Türchen gehören - damit die erste Abfrage sie mitschicken kann. */
export function rememberedYear() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    return parsed && Number.isInteger(Number(parsed.year)) ? Number(parsed.year) : null;
  } catch {
    return null;
  }
}
