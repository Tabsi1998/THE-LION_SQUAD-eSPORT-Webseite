import { useCallback, useState } from "react";

// Einklappen langer Listen in der Verwaltung (#2306): welche Bereiche offen sind, je Schlüssel (z. B. `cat:waffen`). Vorgabe ist zu;
// „Alle aufklappen“/„Alle zuklappen“ setzen die Vorgabe neu und vergessen einzelne Klicks. Solange gesucht oder gefiltert wird
// (`filterKey` nicht leer), sind alle Treffer-Bereiche offen; Klicks dabei gelten nur für diese Suche - ohne Suche ist wieder der
// Stand von vorher da. Der Browser merkt sich nichts; Eingaben in einem zugeklappten Bereich liegen beim Aufrufer und bleiben.

const START = { all: false, own: {}, filterKey: "", filterAll: true, found: {} };

function openIn(state, filterKey, key, base) {
  if (filterKey) {
    if (state.filterKey !== filterKey) return true;
    return state.found[key] ?? state.filterAll;
  }
  return state.own[key] ?? (state.all || base);
}

export function useFold(filterKey = "") {
  const [state, setState] = useState(START);

  /** Ist der Bereich offen? `base`: offen ohne eigenen Klick (z. B. die einzige Kategorie). */
  const isOpen = (key, base = false) => openIn(state, filterKey, key, base);

  const toggle = useCallback((key, base = false) => setState((current) => {
    const next = !openIn(current, filterKey, key, base);
    if (!filterKey) return { ...current, own: { ...current.own, [key]: next } };
    const same = current.filterKey === filterKey;
    return { ...current, filterKey, filterAll: same ? current.filterAll : true, found: { ...(same ? current.found : {}), [key]: next } };
  }), [filterKey]);

  const setAll = useCallback((open) => setState((current) => ({ ...current, all: open, own: {}, filterKey, filterAll: open, found: {} })), [filterKey]);

  /** Einen Bereich ohne Klick öffnen - etwa die erste Kategorie, solange die Season noch nichts sperrt. */
  const open = useCallback((key) => setState((current) => ({ ...current, own: { ...current.own, [key]: true } })), []);

  return { isOpen, toggle, setAll, open };
}
