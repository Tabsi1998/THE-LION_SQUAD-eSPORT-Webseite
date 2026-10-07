import { useEffect, useRef } from "react";
import { cardSignal } from "./cardLift";

/**
 * Das Karten-Signal (#1087) in einer Komponente: `handler` bekommt {type: enter | lift | leave, key, element, rect,
 * lifted}. Hört niemand mehr zu, hängt das Signal nicht mehr am Dokument.
 */
export function useCardSignal(handler, enabled = true) {
  const ref = useRef(handler);
  ref.current = handler;
  useEffect(() => {
    if (!enabled || typeof document === "undefined" || typeof window === "undefined") return undefined;
    return cardSignal(document, window).subscribe((detail) => ref.current?.(detail));
  }, [enabled]);
}
