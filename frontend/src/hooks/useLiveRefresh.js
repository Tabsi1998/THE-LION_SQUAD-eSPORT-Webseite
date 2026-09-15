import { useEffect, useMemo, useRef, useState } from "react";
import {
  invalidationMatches,
  isStreamConnected,
  subscribeApiInvalidation,
  subscribeStreamState,
} from "@/lib/apiInvalidation";

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
 * @param {() => unknown} callback  lädt die Daten der Ansicht
 * @param {string[]} resources     Ressourcen wie bei useApiInvalidation; leer = alles
 * @param {{ fallbackMs?: number, pollMs?: number, debounceMs?: number, enabled?: boolean, onlyVisible?: boolean }} options
 */
export function useLiveRefresh(callback, resources = [], options = {}) {
  const fallbackMs = options.fallbackMs ?? 0;
  const pollMs = options.pollMs ?? 0;
  const debounceMs = options.debounceMs ?? 150;
  const enabled = options.enabled ?? true;
  const onlyVisible = options.onlyVisible ?? true;
  const resourceKey = useMemo(() => resources.join("|"), [resources]);

  const callbackRef = useRef(callback);
  const timerRef = useRef(null);
  const [connected, setConnected] = useState(isStreamConnected);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => subscribeStreamState(setConnected), []);

  useEffect(() => {
    if (!enabled) return undefined;
    const selected = resourceKey ? resourceKey.split("|") : [];
    const schedule = () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        Promise.resolve(callbackRef.current?.()).catch(() => {});
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
  }, [debounceMs, enabled, resourceKey]);

  useEffect(() => {
    const period = pollMs || (connected ? 0 : fallbackMs);
    if (!enabled || !period) return undefined;
    const tick = () => {
      if (onlyVisible && typeof document !== "undefined" && document.hidden) return;
      Promise.resolve(callbackRef.current?.()).catch(() => {});
    };
    const timer = setInterval(tick, period);
    return () => clearInterval(timer);
  }, [connected, enabled, fallbackMs, onlyVisible, pollMs]);

  return connected;
}
