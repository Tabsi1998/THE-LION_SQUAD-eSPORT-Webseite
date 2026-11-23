import { useCallback, useRef } from "react";

// Gegen Doppeltippen (#2173): `busy` im Zustand greift erst nach dem nächsten Zeichnen - zwei Tipps im selben Takt sähen beide
// noch `busy = false` und schickten zweimal. Die Sperre per Ref gilt sofort: Läuft schon eine Aufgabe, wird die zweite verworfen.

export function useSingleFlight() {
  const running = useRef(false);
  return useCallback(async <T,>(task: () => Promise<T>): Promise<T | undefined> => {
    if (running.current) return undefined;
    running.current = true;
    try {
      return await task();
    } finally {
      running.current = false;
    }
  }, []);
}
