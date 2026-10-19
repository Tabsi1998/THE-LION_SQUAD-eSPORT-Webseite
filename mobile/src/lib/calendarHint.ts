import { api } from "./api";

// Der Abo-Hinweis „Deine Termine automatisch im Kalender?“ (#1788) direkt nach einer erfolgreichen Anmeldung zu Event
// oder Turnier - wie im Web (frontend/src/lib/calendarHint.js). Ob er fällig ist, entscheidet der Server
// (GET /api/calendar/hint): nur ohne aktiven Abo-Link und nur, solange er noch nie erschienen ist - gemerkt am Konto,
// damit er auf keinem Gerät wiederkommt. Gezeigt wird er von CalendarHintHost (einmal im Navigator); der meldet beim
// Erscheinen „gesehen“ (POST).

type Listener = () => void;
const listeners = new Set<Listener>();

/** Der Host meldet sich an; zurück kommt das Abmelden. */
export function onCalendarHint(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Fragt nach einer Anmeldung, ob der Hinweis fällig ist, und lässt ihn dann erscheinen. Gibt zurück, ob er kam. */
export async function offerCalendarHint(): Promise<boolean> {
  if (!listeners.size) return false;
  let due = false;
  try {
    const { data } = await api.get<{ due?: boolean }>("/calendar/hint");
    due = Boolean(data?.due);
  } catch {
    return false;
  }
  if (!due || !listeners.size) return false;
  for (const listener of [...listeners]) listener();
  return true;
}

/** Der Hinweis ist erschienen - der Server merkt es sich. Geht das schief, kommt er beim nächsten Mal eben noch einmal. */
export async function markCalendarHintSeen(): Promise<void> {
  try {
    await api.post("/calendar/hint");
  } catch {
    // still - kein Fehler für etwas, das nur ein Hinweis ist
  }
}
