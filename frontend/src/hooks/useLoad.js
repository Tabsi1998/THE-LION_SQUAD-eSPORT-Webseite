import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { problemKind } from "@/lib/loadProblem";

// Laden an einer Stelle (#983, #984, #985; wie useKeyedLoad in der App, #1000/#1512). Drei Regeln statt in jeder Seite:
// - Fehler und leer sind getrennt: „leer“ gibt es nur nach einer erfolgreichen Antwort, ein Fehler ist nie „nichts da“.
// - Nur die zuletzt gestartete Anfrage zählt: wechselt die Kennung (Begriff, Seite, Team), ist der alte Inhalt sofort weg
//   und die alte Anfrage wird abgebrochen; eine verspätete Antwort oder ein verspäteter Fehler verfällt - ebenso alles,
//   was nach dem Verlassen ankommt. Kennung `null` heißt: nichts laden (etwa Suchfeld leer).
// - Scheitert ein Nachladen, bleibt der letzte Stand derselben Kennung stehen - mit `problem` und `stale`, damit die Seite
//   ihn als alt kennzeichnet, statt den Fehler zu verschlucken.
// Die Verwaltung nutzt denselben Baustein (#1353): `problem === "denied"` ist „Dafür fehlt dir …“ (lib/loadProblem.js).

/** Leer ist eine leere Liste oder eine Seite mit leerer `items`-Liste. Alles andere hat Inhalt. */
export function defaultIsEmpty(data) {
  if (data == null) return true;
  if (Array.isArray(data)) return data.length === 0;
  if (Array.isArray(data.items)) return data.items.length === 0;
  return false;
}

function keyOf(key) {
  if (key == null || key === false) return null;
  return typeof key === "string" ? key : JSON.stringify(key);
}

const fresh = (key) => ({ key, data: null, loaded: false, loading: key !== null, error: null, failed: false });

/**
 * @param {string|Array|null} key  wofür geladen wird; ändert sie sich, lädt der Hook neu. `null`: nichts laden.
 * @param {({ key, signal, previous }) => Promise<any>} fetcher  lädt die Daten. `signal` an axios weitergeben (bricht
 *   überholte Anfragen ab); `previous` ist der letzte Stand derselben Kennung - damit behält ein Teil, der diesmal nicht
 *   kam, seinen Stand.
 * @param {{ debounceMs?: number, isEmpty?: (data) => boolean }} options  `debounceMs` für Suchfelder.
 * @returns {{ data, status: "idle"|"loading"|"error"|"empty"|"ok", loading, error, problem, stale, reload, mutate }}
 */
export function useLoad(key, fetcher, { debounceMs = 0, isEmpty = defaultIsEmpty } = {}) {
  const id = keyOf(key);
  const [state, setState] = useState(() => fresh(id));
  const generation = useRef(0);
  const controller = useRef(null);
  const fetcherRef = useRef(fetcher);
  const stateRef = useRef(state);
  // Im Layout-Effekt, nicht im normalen: der normale läuft erst in einer späteren Aufgabe nach dem Schreiben ins Bild
  // (#1570). Wer in diesem Spalt nachlädt, bekäme sonst als `previous` den Stand von vor dem Laden.
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
    stateRef.current = state;
  });

  const cancel = useCallback(() => {
    generation.current += 1;
    controller.current?.abort();
    controller.current = null;
  }, []);

  const reload = useCallback(async () => {
    cancel();
    if (id === null) {
      setState(fresh(null));
      return;
    }
    const mine = generation.current;
    const abort = typeof AbortController === "undefined" ? null : new AbortController();
    controller.current = abort;
    setState((current) => (current.key === id ? { ...current, loading: true } : fresh(id)));
    try {
      const last = stateRef.current;
      const data = await fetcherRef.current({ key: id, signal: abort?.signal, previous: last.key === id ? last.data : null });
      if (generation.current !== mine) return;
      setState({ key: id, data: data ?? null, loaded: true, loading: false, error: null, failed: false });
    } catch (error) {
      if (generation.current !== mine) return;
      setState((current) => (current.key === id
        ? { ...current, loading: false, error, failed: true }
        : { ...fresh(id), loading: false, error, failed: true }));
    } finally {
      if (controller.current === abort) controller.current = null;
    }
  }, [cancel, id]);

  useEffect(() => {
    if (id === null || debounceMs <= 0) {
      void reload();
      return cancel;
    }
    // Beim Tippen: der alte Begriff gilt sofort nicht mehr, gefragt wird erst, wenn die Eingabe kurz ruht.
    cancel();
    setState((current) => (current.key === id ? current : fresh(id)));
    const timer = setTimeout(() => { void reload(); }, debounceMs);
    return () => {
      clearTimeout(timer);
      cancel();
    };
  }, [cancel, debounceMs, id, reload]);

  const mutate = useCallback((update) => {
    setState((current) => (current.key === id && current.loaded && current.data !== null ? { ...current, data: update(current.data) } : current));
  }, [id]);

  // Schon im ersten Bild nach dem Wechsel nichts Altes zeigen - nicht erst, wenn der Effekt gelaufen ist.
  const current = state.key === id ? state : fresh(id);
  let status;
  if (id === null) status = "idle";
  else if (current.loaded) status = isEmpty(current.data) ? "empty" : "ok";
  else if (current.failed) status = "error";
  else status = "loading";

  return {
    data: current.loaded ? current.data : null,
    status,
    loading: id !== null && current.loading,
    error: current.failed ? current.error : null,
    problem: current.failed ? problemKind(current.error) : null,
    stale: current.failed && current.loaded,
    reload,
    mutate,
  };
}
