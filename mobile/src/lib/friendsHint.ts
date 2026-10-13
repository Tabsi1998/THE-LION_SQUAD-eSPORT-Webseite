import { Alert } from "react-native";
import { api } from "./api";

// Der einmalige Hinweis „Deine Freunde sehen, zu welchen Events du angemeldet bist“ (#1188 Teil 2) direkt nach der
// ersten Anmeldung - Event, Turnier oder „Spielst du auch mit?“, nicht erst auf der Event-Seite. Wie im Web
// (frontend/src/lib/friendsHint.js): ob er fällig ist, entscheidet der Server (GET /users/me/friends-hint). „Verstanden“
// bestätigt, „Ausschalten“ schaltet die Einstellung gleich mit aus. Schließt die Person den Hinweis nur (Zurück-Taste),
// kommt er auf dem Screen wieder, auf dem sie dabei ist.

export const FRIENDS_HINT_TITLE = "Deine Freunde sehen das";
export const FRIENDS_HINT_TEXT = "Deine Freunde sehen, zu welchen Events du angemeldet bist.";

async function answer(turnOff: boolean): Promise<void> {
  try {
    await api.post("/users/me/friends-hint", { turn_off: turnOff });
    if (turnOff) Alert.alert("Ausgeschaltet", "Einschalten kannst du es unter Einstellungen → Privatsphäre.");
  } catch {
    Alert.alert("Das hat nicht geklappt", "Du findest die Einstellung unter Einstellungen → Privatsphäre.");
  }
}

/** Fragt nach einer Anmeldung, ob der Hinweis fällig ist, und zeigt ihn dann einmal. Gibt zurück, ob er erschien. */
export async function offerFriendsHint(): Promise<boolean> {
  let due = false;
  try {
    const { data } = await api.get<{ due?: boolean; sharing?: boolean }>("/users/me/friends-hint");
    due = Boolean(data?.due);
  } catch {
    return false;
  }
  if (!due) return false;
  Alert.alert(FRIENDS_HINT_TITLE, `${FRIENDS_HINT_TEXT} Das kannst du jederzeit unter Einstellungen → Privatsphäre ändern.`, [
    { text: "Ausschalten", style: "destructive", onPress: () => { void answer(true); } },
    { text: "Verstanden", onPress: () => { void answer(false); } },
  ]);
  return true;
}
