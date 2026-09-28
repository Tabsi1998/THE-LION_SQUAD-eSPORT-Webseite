import * as SecureStore from "expo-secure-store";

// Signale an die Erfolge (#616) aus der App: Kürbis angeklickt und Co. - je Tag einmal gemerkt, bis der
// Zähler-Dienst der Erfolge II sie entgegennimmt. Nichts geht verloren, nichts zählt doppelt.

const KEY = "season_signals";

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

async function readStore(): Promise<Record<string, number>> {
  try {
    const raw = await SecureStore.getItemAsync(KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

/** true, wenn das Signal heute zum ersten Mal kam. */
export async function recordSignal(name: string): Promise<boolean> {
  const store = await readStore();
  const key = `${name}:${today()}`;
  if (store[key]) return false;
  // Nur die letzten 30 Einträge behalten - der sichere Speicher ist klein.
  const entries = Object.entries(store).slice(-30);
  entries.push([key, 1]);
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(Object.fromEntries(entries)));
  } catch {
    // Ohne Speicher zählt das Signal für diese Sitzung.
  }
  return true;
}
