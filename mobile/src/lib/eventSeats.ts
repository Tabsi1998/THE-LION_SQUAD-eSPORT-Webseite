// Plätze, Warteliste und Einlass bei Events in der App (#2542, #2127; Web: frontend/src/lib/eventSeats.js und lib/eventLead.js):
// dieselbe Rechnung und dieselben Sätze wie im Web - entscheiden tut der Server.

/** „1 Platz“, „2 Plätze“ - nie weniger als einer. */
function placesText(count: number): string {
  const value = Math.max(1, Number(count) || 1);
  return `${value} ${value === 1 ? "Platz" : "Plätze"}`;
}

/**
 * Kommt die Anmeldung auf die Warteliste (EV7)? Dieselbe Rechnung wie der Server: reservierte Plätze plus die eigenen über der Grenze -
 * auch wenn es nur an den Begleitpersonen liegt. Der Satz fürs Formular, sonst leer.
 */
export function waitlistNotice(event: { max_participants?: number | null; registration_summary?: { reserved_seats?: number | null } | null } | null | undefined, seats: number): string {
  const max = Number(event?.max_participants) || 0;
  if (!max) return "";
  const free = Math.max(max - (Number(event?.registration_summary?.reserved_seats) || 0), 0);
  const wanted = Math.max(1, Number(seats) || 1);
  if (wanted <= free) return "";
  if (!free) return "Das Event ist voll – du kommst auf die Warteliste.";
  return `Nur noch ${placesText(free)} frei – mit ${wanted} ${wanted === 1 ? "Platz" : "Plätzen"} kommst du auf die Warteliste.`;
}

/** Was der Server entschieden hat - in der Zwischenzeit kann der letzte Platz weg sein. */
export function registeredText(status?: string | null): string {
  return status === "waitlist" ? "Du stehst auf der Warteliste. Wird ein Platz frei, bekommst du Bescheid." : "Du bist angemeldet.";
}

/** Wie lange „Rückgängig“ nach dem Einchecken bleibt (EV14). */
export const CHECKIN_UNDO_MS = 10_000;

/** Der Satz nach dem Einchecken bzw. dem Zurücknehmen (wie changeText im Web). */
export function checkInText(name: string | null | undefined, status: "checked_in" | "registered"): string {
  const who = name || "Die Person";
  return status === "checked_in" ? `${who} ist da.` : `${who} ist wieder „noch nicht da“.`;
}
