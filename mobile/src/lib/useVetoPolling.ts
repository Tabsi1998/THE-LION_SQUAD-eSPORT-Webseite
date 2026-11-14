import { useEffect, useRef } from "react";
import { AppState } from "react-native";
import { vetoDeadline, vetoPollMs, type VetoBlock } from "./leagueVeto";

// Kurzer Abruf des Map-Vetos in der App (#2173, wie hooks/useVetoPolling.js im Web, docs/LIGA.md D.4): Takt aus `vetoPollMs`
// (läuft 2 s, Pause 5 s, Warten auf „Bereit“ 3 s). Im Hintergrund (App nicht aktiv) oder auf einem verdeckten Screen fragt die App
// nicht nach, beim Zurückkommen sofort einmal. Kurz nach der Frist des laufenden Schritts einmal extra: dann steht die Zufallswahl.

export const AFTER_DEADLINE_MS = 800;
const LONGEST_WAIT_MS = 10 * 60 * 1000;

const awake = () => AppState.currentState !== "background" && AppState.currentState !== "inactive";

export function useVetoPolling(block: VetoBlock | null | undefined, onPoll: (() => void) | null, { bothIn = false, offset = 0, enabled = true }: { bothIn?: boolean; offset?: number; enabled?: boolean } = {}) {
  const pollRef = useRef(onPoll);
  useEffect(() => {
    pollRef.current = onPoll;
  }, [onPoll]);
  const period = enabled && onPoll ? vetoPollMs(block, { bothIn }) : 0;
  useEffect(() => {
    if (!period) return undefined;
    const tick = setInterval(() => {
      if (awake()) pollRef.current?.();
    }, period);
    const subscription = AppState.addEventListener?.("change", (next) => {
      if (next === "active") pollRef.current?.();
    });
    return () => {
      clearInterval(tick);
      subscription?.remove?.();
    };
  }, [period]);
  const deadline = enabled && onPoll ? vetoDeadline(block, offset) : null;
  useEffect(() => {
    if (deadline == null) return undefined;
    const wait = deadline - Date.now() + AFTER_DEADLINE_MS;
    if (wait < 0 || wait > LONGEST_WAIT_MS) return undefined;
    const timer = setTimeout(() => {
      if (awake()) pollRef.current?.();
    }, wait);
    return () => clearTimeout(timer);
  }, [deadline]);
}
