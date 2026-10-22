import { useEffect, useState } from "react";
import { AccessibilityInfo } from "react-native";
import { useReducedMotion } from "react-native-reanimated";

/**
 * „Bewegung reduzieren“ bzw. „Animationen entfernen“ (#1969) - sofort beim ersten Zeichnen. Reanimated liest die
 * Einstellung beim Start der App synchron (`useReducedMotion`), es läuft also nie kurz Bewegung an, bevor das Handy
 * geantwortet hat. Ändert jemand die Einstellung, während die App offen ist, folgt der Wert (`reduceMotionChanged`).
 * Das ist die eine Quelle für alle Bewegung in der App.
 */
export function useReduceMotion(): boolean {
  const atStart = useReducedMotion();
  const [reduce, setReduce] = useState<boolean>(Boolean(atStart));
  useEffect(() => {
    let active = true;
    // Gegenprobe beim Handy: stimmt sie nicht mit dem Startwert überein (Einstellung inzwischen geändert), gilt sie.
    // Promise.resolve: manche Umgebungen (Tests mit wiederhergestellten Mocks) liefern hier kein Promise.
    Promise.resolve(AccessibilityInfo.isReduceMotionEnabled?.())
      .then((value) => { if (active && typeof value === "boolean") setReduce(value); })
      .catch(() => {});
    const subscription = AccessibilityInfo.addEventListener?.("reduceMotionChanged", (value) => setReduce(Boolean(value)));
    return () => {
      active = false;
      subscription?.remove?.();
    };
  }, []);
  return reduce;
}
