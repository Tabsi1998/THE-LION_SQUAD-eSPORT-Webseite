import { useEffect, useState } from "react";

// Hinausgleiten (#1653, #1166, #2393): Was aus einer Liste verschwindet, bleibt noch kurz an seinem Platz stehen und
// blendet aus - dieselbe Karte mit demselben Schlüssel, statt zu verschwinden. Wie `useDisplayed` im Web
// (components/tls/tournament/NoticeBanner.jsx). Die Liste der verschwindenden wird beim Zeichnen nachgeführt: Schon das
// erste Bild ohne den Eintrag hält seine Karte noch. `still` (Bewegung reduzieren): nichts bleibt stehen.

export type Displayed<T> = { item: T; leaving: boolean };

export function useLeaving<T>(items: T[], idOf: (item: T) => string, leaveMs: number, still = false): Displayed<T>[] {
  const key = items.map(idOf).join("|");
  const [state, setState] = useState<{ key: string; items: T[]; leaving: Array<{ item: T; index: number }> }>({ key, items, leaving: [] });
  if (state.key !== key) {
    const ids = new Set(items.map(idOf));
    const gone = still ? [] : state.items.map((item, index) => ({ item, index })).filter(({ item }) => !ids.has(idOf(item)));
    const kept = state.leaving.filter(({ item }) => !ids.has(idOf(item)) && !gone.some((entry) => idOf(entry.item) === idOf(item)));
    setState({ key, items, leaving: still ? [] : [...kept, ...gone] });
  }
  const leavingKey = state.leaving.map((entry) => idOf(entry.item)).join("|");
  useEffect(() => {
    if (!leavingKey) return undefined;
    const timer = setTimeout(() => setState((current) => ({ ...current, leaving: [] })), leaveMs);
    return () => clearTimeout(timer);
    // Nur eine neue Menge verschwindender Einträge startet die Zeit neu.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leavingKey]);
  const ids = new Set(items.map(idOf));
  const list: Displayed<T>[] = items.map((item) => ({ item, leaving: false }));
  [...state.leaving]
    .filter(({ item }) => !ids.has(idOf(item)))
    .sort((a, b) => a.index - b.index)
    .forEach(({ item, index }) => list.splice(Math.min(index, list.length), 0, { item, leaving: true }));
  return list;
}
