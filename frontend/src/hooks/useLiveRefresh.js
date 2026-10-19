import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  invalidationMatches,
  isStreamConnected,
  subscribeApiInvalidation,
  subscribeStreamState,
} from "@/lib/apiInvalidation";

// Hängt eine Abfrage (die API kennt kein Zeitlimit), darf nach dieser Zeit trotzdem eine neue starten.
export const LIVE_REFRESH_STUCK_MS = 30000;

/**
 * Lädt neu, wenn der Änderungsstrom eine passende Änderung meldet - und nur
 * dann. Fehlt die Verbindung zum Strom, fragt der Hook im Takt `fallbackMs`
 * nach, bis sie wieder steht; danach lädt er einmal nach, weil dazwischen
 * Änderungen verloren gegangen sein können.
 *
 * Vorher hatten 25 Ansichten ihr eigenes setInterval neben dem Strom und
 * luden alles doppelt (#221). Reine Uhren und Wechsel von Ansichten bleiben
 * bei setInterval; sie fragen keinen Server.
 *
 * `pollMs` fragt immer im Takt, auch mit Strom - für Daten, die der Server
 * selbst nur abfragt (Twitch), sodass der Strom ihren Wechsel nie meldet.
 *
 * Nie zwei Abfragen derselben Ansicht zugleich (#1683): Kommt eine Änderung,
 * während die Abfrage noch läuft, folgt genau eine weitere danach. Sonst
 * stapeln sich bei vielen Zuschauern und langsamem Server die Abfragen - jede
 * Meldung startet eine neue, während die alten noch laufen (Lasttest).
 * `overlap: true` lässt Abfragen wie bisher überlappen - für Ansichten, die
 * Antworten selbst ordnen und jede Meldung sofort brauchen (TV-Baum).
 *
 * @param {() => unknown} callback  lädt die Daten der Ansicht
 * @param {string[]} resources     Ressourcen wie bei useApiInvalidation; leer = alles
 * @param {{ fallbackMs?: number, pollMs?: number, debounceMs?: number, enabled?: boolean, onlyVisible?: boolean, overlap?: boolean }} options
 */
export function useLiveRefresh(callback, resources = [], options = {}) {
  const fallbackMs = options.fallbackMs ?? 0;
  const pollMs = options.pollMs ?? 0;
  const debounceMs = options.debounceMs ?? 150;
  const enabled = options.enabled ?? true;
  const onlyVisible = options.onlyVisible ?? true;
  const overlap = options.overlap ?? false;
  const resourceKey = useMemo(() => resources.join("|"), [resources]);

  const callbackRef = useRef(callback);
  const timerRef = useRef(null);
  const flightRef = useRef({ running: false, again: false, startedAt: 0, token: null, alive: true });
  const [connected, setConnected] = useState(isStreamConnected);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  // Läuft schon eine Abfrage, merkt sich ein weiterer Aufruf nur „danach noch einmal“.
  const run = useCallback(function runOnce() {
    if (overlap) {
      Promise.resolve(callbackRef.current?.()).catch(() => {});
      return;
    }
    const flight = flightRef.current;
    if (flight.running && Date.now() - flight.startedAt < LIVE_REFRESH_STUCK_MS) {
      flight.again = true;
      return;
    }
    const token = {};
    Object.assign(flight, { running: true, again: false, startedAt: Date.now(), token });
    const done = () => {
      // Eine hängende Abfrage, die schon abgelöst ist, gibt nichts mehr frei.
      if (flight.token !== token) return;
      flight.running = false;
      if (flight.again && flight.alive) runOnce();
    };
    let result;
    try {
      result = callbackRef.current?.();
    } catch {
      done();
      return;
    }
    if (result && typeof result.then === "function") Promise.resolve(result).catch(() => {}).finally(done);
    else done();
  }, [overlap]);

  useEffect(() => {
    const flight = flightRef.current;
    flight.alive = true;
    return () => {
      flight.alive = false;
    };
  }, []);

  useEffect(() => subscribeStreamState(setConnected), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const selected = resourceKey ? resourceKey.split("|") : [];
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        run();
      }, debounceMs);
    };
    const unsubscribeChanges = subscribeApiInvalidation((event) => {
      if (invalidationMatches(event, selected)) schedule();
    });
    // Nach einer Unterbrechung einmal nachladen; kommt gleichzeitig ein
    // Reset vom Server, fällt beides in dieselbe Entprellung.
    const unsubscribeState = subscribeStreamState((isConnected) => {
      if (isConnected) schedule();
    });
    return () => {
      unsubscribeChanges();
      unsubscribeState();
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [debounceMs, enabled, resourceKey, run]);

  useEffect(() => {
    const period = pollMs || (connected ? 0 : fallbackMs);
    if (!enabled || !period) return undefined;
    const tick = () => {
      if (onlyVisible && typeof document !== "undefined" && document.hidden) return;
      run();
    };
    const timer = setInterval(tick, period);
    return () => clearInterval(timer);
  }, [connected, enabled, fallbackMs, onlyVisible, pollMs, run]);

  return connected;
}
