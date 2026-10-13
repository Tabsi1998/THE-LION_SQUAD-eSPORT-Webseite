import { useState } from "react";

/**
 * Zählt echte Kontowechsel (#1047): hoch geht es nur, wenn vorher ein Konto angemeldet war und jetzt ein anderes
 * oder keines. Das erste Laden der Sitzung (`undefined` → Konto) und eine Anmeldung aus dem Gastzustand
 * (`null` → Konto) zählen nicht - sonst würde jede Seite beim Start ein zweites Mal aufgebaut und geladen.
 *
 * Gedacht als Teil eines `key`, damit eine Ansicht mit allen Entwürfen beim Kontowechsel neu beginnt.
 *
 * @param {string | null | undefined} accountId  die ID des angemeldeten Kontos
 * @returns {number}
 */
export function useAccountGeneration(accountId) {
  const id = accountId || null;
  const [seen, setSeen] = useState({ id, generation: 0 });
  if (seen.id === id) return seen.generation;
  // Abgeleiteter Zustand während des Renderns (wie in der React-Doku): React rendert sofort mit dem neuen Stand neu.
  const next = { id, generation: seen.id ? seen.generation + 1 : seen.generation };
  setSeen(next);
  return next.generation;
}
