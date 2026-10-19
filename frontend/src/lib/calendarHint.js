// Der Abo-Hinweis „Deine Termine automatisch im Kalender?“ (#1788) direkt nach einer erfolgreichen Anmeldung zu Event,
// Turnier oder Fast Lap. Ob er fällig ist, entscheidet der Server (GET /api/calendar/hint): nur ohne aktiven Abo-Link und
// nur, solange er noch nie erschienen ist - gemerkt am Konto, nicht im Browser, damit er auch auf dem Handy nicht
// wiederkommt. Gezeigt wird er von CalendarHintHost (einmal in App.jsx); der meldet beim Erscheinen „gesehen“.
import { api } from "@/lib/api";

export const CALENDAR_HINT_EVENT = "tls:calendar-hint";

/** Fragt nach einer Anmeldung, ob der Hinweis fällig ist, und lässt ihn dann erscheinen. Gibt zurück, ob er kam. */
export async function offerCalendarHint(win = typeof window === "undefined" ? null : window) {
  let due = false;
  try {
    const { data } = await api.get("/calendar/hint");
    due = Boolean(data?.due);
  } catch {
    return false;
  }
  if (!due || !win) return false;
  win.dispatchEvent(new CustomEvent(CALENDAR_HINT_EVENT));
  return true;
}

/** Der Hinweis ist erschienen - der Server merkt es sich. Geht das schief, kommt er beim nächsten Mal eben noch einmal. */
export async function markCalendarHintSeen() {
  try {
    await api.post("/calendar/hint");
  } catch {
    // still - kein Fehler für etwas, das nur ein Hinweis ist
  }
}
