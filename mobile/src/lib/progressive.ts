import { useEffect, useState } from "react";

/**
 * Lange Listen schrittweise aufbauen (Erfolge II E13, #623): erst `first` Einträge, danach je kurzem Takt
 * `step` weitere - der erste Blick steht sofort, und zwischen den Schritten bleibt die App bedienbar.
 * Ändert sich `resetKey` (z. B. der Filter), beginnt es wieder vorn.
 */
export function useProgressiveCount(total: number, resetKey: unknown, first = 16, step = 16): number {
  const [state, setState] = useState({ key: resetKey, count: Math.min(total, first) });
  const count = state.key === resetKey ? Math.min(state.count, total) : Math.min(total, first);
  useEffect(() => {
    if (state.key !== resetKey) {
      setState({ key: resetKey, count: Math.min(total, first) });
      return undefined;
    }
    if (count >= total) return undefined;
    const timer = setTimeout(() => setState((current) => ({ key: current.key, count: Math.min(total, current.count + step) })), 16);
    return () => clearTimeout(timer);
  }, [state.key, resetKey, count, total, first, step]);
  return count;
}
