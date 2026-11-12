import { useEffect, useRef } from "react";
import { vetoDeadline, vetoPollMs } from "@/lib/leagueVeto";

// Kurzer Abruf des Map-Vetos (D.4, #1651) - es gibt keinen WebSocket. Der Takt kommt aus `vetoPollMs` (läuft: 2 s, Pause: 5 s, Warten
// auf „Bereit“: 3 s); im Hintergrund-Tab fragt die Seite nicht nach, beim Zurückkommen sofort einmal. Kurz nach der Frist des
// laufenden Schritts fragt sie zusätzlich einmal nach: Dann hat der Server die Zufallswahl gesetzt, und die Seite wartet nicht auf den
// nächsten Takt. `idleMs`: ein ruhiger Takt, wenn sonst nichts nachzufragen ist (TV vor dem Start und nach dem Ende).

export const AFTER_DEADLINE_MS = 800;
const LONGEST_WAIT_MS = 10 * 60 * 1000;

const hidden = () => typeof document !== "undefined" && document.hidden;

export function useVetoPolling(block, onPoll, { bothIn = false, offset = 0, idleMs = 0 } = {}) {
  const pollRef = useRef(onPoll);
  useEffect(() => {
    pollRef.current = onPoll;
  }, [onPoll]);
  const period = onPoll ? vetoPollMs(block, { bothIn }) || idleMs : 0;
  useEffect(() => {
    if (!period) return undefined;
    const tick = window.setInterval(() => {
      if (!hidden()) pollRef.current?.();
    }, period);
    const back = () => {
      if (!hidden()) pollRef.current?.();
    };
    document.addEventListener("visibilitychange", back);
    return () => {
      window.clearInterval(tick);
      document.removeEventListener("visibilitychange", back);
    };
  }, [period]);
  const deadline = onPoll ? vetoDeadline(block, offset) : null;
  useEffect(() => {
    if (deadline == null) return undefined;
    const wait = deadline - Date.now() + AFTER_DEADLINE_MS;
    if (wait < 0 || wait > LONGEST_WAIT_MS) return undefined;
    const timer = window.setTimeout(() => {
      if (!hidden()) pollRef.current?.();
    }, wait);
    return () => window.clearTimeout(timer);
  }, [deadline]);
}
