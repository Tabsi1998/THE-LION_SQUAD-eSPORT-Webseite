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
 * Antworten selbst ordnen und jede Meldung sofort brauchen (TV-Baum). Es gilt,
 * was beim ersten Render übergeben wurde.
 *
 * Nur das eigene Turnier (#1801): `tournamentId` (und `eventId`) - dann laden nur Änderungen dieses Turniers nach
 * (bei Ansichten mit Stationen auch die der anderen Turniere desselben Events). Meldungen ohne Turnier und Ansichten,
 * die ihr Turnier noch nicht geladen haben (`tournamentId` leer), laden wie bisher bei jeder passenden Änderung.
 *
 * @param {() => unknown} callback  lädt die Daten der Ansicht
 * @param {string[]} resources     Ressourcen wie bei useApiInvalidation; leer = alles
 * @param {{ fallbackMs?: number, pollMs?: number, debounceMs?: number, enabled?: boolean, onlyVisible?: boolean, overlap?: boolean, tournamentId?: string|null, eventId?: string|null }} options
 */
export function useLiveRefresh(callback, resources = [], options = {}) {
  const fallbackMs = options.fallbackMs ?? 0;
  const pollMs = options.pollMs ?? 0;
  const debounceMs = options.debounceMs ?? 150;
  const enabled = options.enabled ?? true;
  const onlyVisible = options.onlyVisible ?? true;
  const { tournamentId = null, eventId = null } = options;
  // Fest ab dem ersten Render: ein Wechsel mittendrin ließe alte überlappende Abfragen neben der einen laufen.
  const [overlap] = useState(() => options.overlap ?? false);
  const resourceKey = useMemo(() => resources.join("|"), [resources]);

  const callbackRef = useRef(callback);
  const enabledRef = useRef(enabled);
  // Im Ref statt im Abo: Kennt die Seite ihr Turnier erst nach dem Laden, bleibt das Abo stehen - eine gerade
  // entprellte Änderung geht dabei nicht verloren.
  const scopeRef = useRef({ tournamentId, eventId });
  const timerRef = useRef(null);
  const flightRef = useRef({ running: false, again: false, startedAt: 0, token: null, alive: true, stuckTimer: null });
  const [connected, setConnected] = useState(isStreamConnected);

  useEffect(() => {
    callbackRef.current = callback;
  }, [callback]);

  useEffect(() => {
    scopeRef.current = { tournamentId, eventId };
  }, [tournamentId, eventId]);

  // Läuft schon eine Abfrage, merkt sich ein weiterer Aufruf nur „danach noch einmal“.
  //
  // Grenze: Eine abgelöste, hängende Abfrage kann ihr Ergebnis noch spät setzen und so einen neueren Stand
  // überschreiben (wie vorher bei überlappenden Abfragen). Verhindern ließe sich das nur, wenn der Hook dem Ladevorgang
  // ein Kennzeichen mitgibt - die Ladefunktionen nehmen aber eigene Parameter (z. B. MatchPage `load({ preserveDrafts })`).
  // Ansichten, die das brauchen, ordnen Antworten selbst (TV-Baum: seqRef) und nutzen `overlap: true`.
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
    clearTimeout(flight.stuckTimer);
    Object.assign(flight, { running: true, again: false, startedAt: Date.now(), token });
    // Hängt die Abfrage und wartet eine Meldung, startet nach LIVE_REFRESH_STUCK_MS von selbst eine neue - sonst
    // bliebe die Ansicht bei stehendem Strom ohne weitere Meldung für immer auf dem alten Stand.
    flight.stuckTimer = setTimeout(() => {
      flight.stuckTimer = null;
      if (flight.token === token && flight.running && flight.again && flight.alive && enabledRef.current) runOnce();
    }, LIVE_REFRESH_STUCK_MS);
    const done = () => {
      // Eine hängende Abfrage, die schon abgelöst ist, gibt nichts mehr frei.
      if (flight.token !== token) return;
      clearTimeout(flight.stuckTimer);
      flight.stuckTimer = null;
      flight.running = false;
      if (flight.again && flight.alive && enabledRef.current) runOnce();
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
      clearTimeout(flight.stuckTimer);
      flight.stuckTimer = null;
    };
  }, []);

  // Abgeschaltet (z. B. Spiel beendet): keine Abfrage mehr von selbst - weder nach 30 s noch hinter der laufenden.
  useEffect(() => {
    enabledRef.current = enabled;
    if (enabled) return;
    const flight = flightRef.current;
    clearTimeout(flight.stuckTimer);
    flight.stuckTimer = null;
    flight.again = false;
  }, [enabled]);

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
      if (invalidationMatches(event, selected, scopeRef.current)) schedule();
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
