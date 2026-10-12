import { createContext, useContext } from "react";

// Der Schlüssel der Karte mit Platz (`Card perch="..."`, #1087), den alles in ihr lesen kann - die Deko der Saisons
// (useCardLift.ts) und seit #1295 auch Schrift und Knöpfe, die sich für die Platzprüfung melden (useRoom.ts).

export const CardKeyContext = createContext<string | null>(null);

/** Der Schlüssel der Karte, in der die Komponente liegt - null außerhalb einer Karte mit Platz. */
export function useCardKey(): string | null {
  return useContext(CardKeyContext);
}
