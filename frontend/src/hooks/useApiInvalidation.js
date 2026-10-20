import { useEffect, useMemo, useRef } from "react";
import { invalidationMatches, subscribeApiInvalidation } from "@/lib/apiInvalidation";

/**
 * @param {(event: object) => unknown} callback
 * @param {string[]} resources  Ressourcen der Ansicht; leer = alles
 * @param {{ debounceMs?: number, tournamentId?: string|null, eventId?: string|null }} options  `tournamentId` (und
 *   `eventId`): nur Änderungen dieses Turniers laden nach (#1801, siehe invalidationMatches)
 */
export function useApiInvalidation(callback, resources = [], options = {}) {
  const callbackRef = useRef(callback);
  const timerRef = useRef(null);
  const debounceMs = options.debounceMs ?? 150;
  const resourceKey = useMemo(() => resources.join("|"), [resources]);
  const { tournamentId = null, eventId = null } = options;
  // Im Ref statt im Abo: Kennt die Seite ihr Turnier erst nach dem Laden, bleibt das Abo stehen.
  const scopeRef = useRef({ tournamentId, eventId });

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    scopeRef.current = { tournamentId, eventId };
  }, [tournamentId, eventId]);

  useEffect(() => {
    const selectedResources = resourceKey ? resourceKey.split("|") : [];
    return subscribeApiInvalidation((event) => {
      if (!invalidationMatches(event, selectedResources, scopeRef.current)) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        Promise.resolve(callbackRef.current?.(event)).catch(() => {});
      }, debounceMs);
    });
  }, [debounceMs, resourceKey]);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);
}
