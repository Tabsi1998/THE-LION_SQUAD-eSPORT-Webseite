import { createContext, useContext, useEffect, useRef } from "react";
import { subscribeCardLift, type CardLift } from "./cardLift";
import { useSeason } from "./SeasonProvider";

// Das Karten-Signal (#1087) in Komponenten: `useCardLift` hört zu, solange `enabled` ist und das Handy keine
// reduzierte Bewegung will - mit „Bewegung reduzieren“ hört niemand zu, dann gibt es auch kein Signal. Eine Karte mit
// Platz (`Card perch="..."`) gibt ihren Schlüssel an alles in ihr weiter (`useCardKey`) - so weiß Deko wie die
// Schneehaube an der Begrüßungskarte, zu welcher Karte sie gehört.

export const CardKeyContext = createContext<string | null>(null);

/** Der Schlüssel der Karte, in der die Komponente liegt - null außerhalb einer Karte mit Platz. */
export function useCardKey(): string | null {
  return useContext(CardKeyContext);
}

export function useCardLift(handler: (detail: CardLift) => void, enabled = true): void {
  const { reducedMotion } = useSeason();
  const ref = useRef(handler);
  ref.current = handler;
  const active = enabled && !reducedMotion;
  useEffect(() => {
    if (!active) return undefined;
    return subscribeCardLift((detail) => ref.current(detail));
  }, [active]);
}
