import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { QUEUE_TIMEOUT_MS, queueGoneError } from "@/lib/liveQueue";

// Die Live-Warteschlange einer Seite (#1556) mit dem Verhalten am Turniertag (#2440): Scheitert ein Abruf (Netz,
// Server, Zeitüberschreitung), bleibt der letzte gute Stand stehen - samt Reiter und offener Rückfragen in den
// Stationskacheln - und `staleSince` sagt, von wann er ist. Nur der Server nimmt die Warteschlange weg: `applies: false`
// oder 404/403 (lib/liveQueue: queueGoneError). Nie zwei Abrufe zugleich: Ein Aufruf, während einer läuft, hängt genau
// einen weiteren an. Jeder Aufruf fragt sofort - Meldungen aus dem Strom, Wiederverbinden und Tipps der Leitung. Nur den
// Takt bremst die Seite nach Fehlern selbst: `failures` mit lib/liveQueue.queuePollMs.

const LOADING = Object.freeze({ path: "", queue: null, status: "loading", okAt: 0, failures: 0 });

/**
 * @param {string} path  z. B. `/tournaments/<slug>/live-queue`; leer = keine Abfrage (keine Warteschlange)
 * @returns {{ queue: object|null, status: "loading"|"applies"|"none"|"unknown", loaded: boolean, staleSince: number,
 *   failures: number, reload: () => Promise<void> }}
 *   `status`: `applies` mit Warteschlange, `none` ohne (vom Server so gesagt), `unknown` - der erste Abruf scheiterte.
 *   `staleSince`: Zeitpunkt (ms, Geräteuhr) des letzten guten Stands, solange das Nachladen scheitert - sonst 0.
 *   `failures`: Fehlschläge in Folge (0 nach einem gelungenen Abruf).
 */
export function useLiveQueue(path) {
  const [state, setState] = useState(() => ({ ...LOADING, path, status: path ? "loading" : "none" }));
  const pathRef = useRef(path);
  const flightRef = useRef({ promise: null, again: false });

  const fetchOnce = useCallback(async (asked) => {
    try {
      const { data } = await api.get(asked, { timeout: QUEUE_TIMEOUT_MS });
      if (pathRef.current !== asked) return;
      const applies = Boolean(data?.applies);
      setState({ path: asked, queue: applies ? data : null, status: applies ? "applies" : "none", okAt: Date.now(), failures: 0 });
    } catch (error) {
      if (pathRef.current !== asked) return;
      if (queueGoneError(error)) {
        setState({ path: asked, queue: null, status: "none", okAt: Date.now(), failures: 0 });
        return;
      }
      setState((prev) => (prev.path === asked
        ? { ...prev, status: prev.status === "loading" ? "unknown" : prev.status, failures: prev.failures + 1 }
        : { ...LOADING, path: asked, status: "unknown", failures: 1 }));
    }
  }, []);

  const reload = useCallback(() => {
    const flight = flightRef.current;
    if (!pathRef.current) return Promise.resolve();
    if (flight.promise) {
      flight.again = true;
      return flight.promise;
    }
    const run = async () => {
      do {
        flight.again = false;
        await fetchOnce(pathRef.current);
      } while (flight.again && pathRef.current);
    };
    flight.promise = run().finally(() => { flight.promise = null; });
    return flight.promise;
  }, [fetchOnce]);

  useEffect(() => {
    pathRef.current = path;
    if (path) reload();
    // Abgebaut oder Turnier gewechselt: eine noch laufende Antwort gilt nicht mehr, und es folgt keine weitere.
    return () => { pathRef.current = ""; };
  }, [path, reload]);

  // Ein Stand eines anderen Pfads (Turnier gewechselt) gilt nicht - bis der neue da ist, „wird geladen“.
  const current = state.path === path ? state : { ...LOADING, path, status: path ? "loading" : "none" };
  return {
    queue: current.queue,
    status: current.status,
    loaded: current.status !== "loading",
    staleSince: current.failures && current.queue ? current.okAt : 0,
    failures: current.failures,
    reload,
  };
}

