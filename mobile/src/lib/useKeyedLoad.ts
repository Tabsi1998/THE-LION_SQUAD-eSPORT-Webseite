import { useCallback, useEffect, useRef, useState } from "react";
import { loadProblem, type LoadProblem } from "../components/ListState";

// Laden einer Detailseite mit Kennung (#1000). Drei Regeln an einer Stelle statt in jedem Screen:
// - Wechselt die Kennung, ist der alte Inhalt sofort weg (Laden, dann B oder der Fehler von B) - nie A unter dem Namen B.
// - Nur die zuletzt gestartete Anfrage zählt: eine verspätete Antwort (für A oder ein älteres Nachladen) wird verworfen,
//   ebenso alles, was nach dem Verlassen des Screens ankommt.
// - Scheitert ein Nachladen, bleibt der letzte Stand derselben Kennung stehen - mit `problem` und `stale`, damit der Screen
//   ihn als alt kennzeichnet (etwa mit `PartialLoadNotice`) statt den Fehler zu verschlucken.

export type KeyedLoad<T> = {
  /** Die Daten der aktuellen Kennung - null, solange es keine gibt. */
  data: T | null;
  /** Lädt gerade (erstes Laden oder Nachladen). */
  loading: boolean;
  /** Der Fehler der letzten Anfrage - auch, wenn noch ein älterer Stand da ist. */
  error: unknown;
  /** Was beim letzten Laden schiefging (#1152) - null, wenn es geklappt hat. */
  problem: LoadProblem | null;
  /** `data` ist ein älterer Stand: das letzte Nachladen ist gescheitert. */
  stale: boolean;
  /** Nochmal laden (Nochmal versuchen, Ziehen zum Aktualisieren). */
  reload: () => Promise<void>;
};

type State<T> = { key: string; data: T | null; loading: boolean; error: unknown; failed: boolean };

const fresh = <T,>(key: string): State<T> => ({ key, data: null, loading: true, error: null, failed: false });

export function useKeyedLoad<T>(key: string, fetcher: (key: string) => Promise<T>): KeyedLoad<T> {
  const [state, setState] = useState<State<T>>(() => fresh<T>(key));
  const generation = useRef(0);
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });

  const reload = useCallback(async () => {
    generation.current += 1;
    const mine = generation.current;
    setState((current) => (current.key === key ? { ...current, loading: true } : fresh<T>(key)));
    try {
      const data = await fetcherRef.current(key);
      if (generation.current !== mine) return;
      setState({ key, data, loading: false, error: null, failed: false });
    } catch (error) {
      if (generation.current !== mine) return;
      setState((current) => ({ key, data: current.key === key ? current.data : null, loading: false, error, failed: true }));
    }
  }, [key]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Nach dem Verlassen gilt keine Antwort mehr.
  useEffect(() => () => {
    generation.current += 1;
  }, []);

  // Schon im ersten Bild nach dem Wechsel nichts Altes zeigen - nicht erst, wenn der Effekt gelaufen ist.
  const current = state.key === key ? state : fresh<T>(key);
  return {
    data: current.data,
    loading: current.loading,
    error: current.failed ? current.error : null,
    problem: current.failed ? loadProblem(current.error) : null,
    stale: current.failed && current.data !== null,
    reload,
  };
}
