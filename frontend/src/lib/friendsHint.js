// Der einmalige Hinweis „Deine Freunde sehen, zu welchen Events du angemeldet bist“ (#1188 Teil 2) direkt nach der
// ersten Anmeldung - Event, Turnier oder „Spielst du auch mit?“, nicht erst auf der Event-Seite. Ob er fällig ist,
// entscheidet der Server (GET /users/me/friends-hint, services/event_friends.py → hint_due): die Person teilt ihre
// Anmeldungen, hat den Hinweis noch nicht beantwortet und ist verbindlich angemeldet. „Verstanden“ bestätigt,
// „Ausschalten“ schaltet die Einstellung gleich mit aus. Schließt die Person den Hinweis nur, kommt er auf der Seite
// wieder, auf der sie dabei ist. Die App fragt dasselbe (mobile/src/lib/friendsHint.ts).
import { toast } from "sonner";
import { api } from "@/lib/api";

export const FRIENDS_HINT_TEXT = "Deine Freunde sehen, zu welchen Events du angemeldet bist.";
const TOAST_ID = "tls-friends-hint";

async function answer(turnOff) {
  try {
    await api.post("/users/me/friends-hint", { turn_off: turnOff });
    if (turnOff) toast.success("Ausgeschaltet. Einschalten kannst du es unter Profil → Privatsphäre.");
  } catch {
    toast.error("Das hat nicht geklappt. Du findest die Einstellung unter Profil → Privatsphäre.");
  }
}

/** Fragt nach einer Anmeldung, ob der Hinweis fällig ist, und zeigt ihn dann einmal. Gibt zurück, ob er erschien. */
export async function offerFriendsHint() {
  let due = false;
  try {
    const { data } = await api.get("/users/me/friends-hint");
    due = Boolean(data?.due);
  } catch {
    return false;
  }
  if (!due) return false;
  toast(FRIENDS_HINT_TEXT, {
    id: TOAST_ID,
    description: "Das kannst du jederzeit unter Profil → Privatsphäre ändern.",
    duration: Infinity,
    action: { label: "Ausschalten", onClick: () => { void answer(true); } },
    cancel: { label: "Verstanden", onClick: () => { void answer(false); } },
  });
  return true;
}
