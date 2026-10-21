// Nachrücker nach dem Check-in-Ende (#1551): wo die Person im Baum gelandet ist - Antwortfeld `placement` des Servers.

export function placementMessage(placement) {
  if (!placement) return null;
  if (!placement.ok) return { tone: "warning", text: placement.detail || "Im Turnierbaum ist kein Platz frei." };
  return placement.kind === "bye"
    ? { tone: "success", text: "Rückt auf einen Platz mit Freilos nach – dieses Spiel wird jetzt gespielt." }
    : { tone: "success", text: "Rückt auf den Platz einer Person „Nicht erschienen“ nach." };
}

const registrationName = (registration) => registration?.display_name || registration?.user?.display_name || registration?.ingame_name || "";

/**
 * Die Meldung nach einem Check-in-Schritt der Turnierleitung. Bei „Nicht erschienen“ mit Nachrücken (#1941) nennt sie,
 * wer von der Warteliste nachgerückt ist - Antwortfeld `waitlist_moved_up` (Kennungen), Namen aus der Teilnehmerliste.
 */
export function checkinStatusText(status, data, registrations = []) {
  if (status === "checked_in") return "Check-in gesetzt.";
  if (status !== "no_show") return "Check-in zurückgenommen.";
  const moved = data?.waitlist_moved_up || [];
  if (!moved.length) return "Nicht erschienen gesetzt.";
  const byId = new Map((registrations || []).map((registration) => [registration.id, registration]));
  const names = moved.map((id) => registrationName(byId.get(id))).filter(Boolean);
  if (names.length === moved.length) return `Nicht erschienen gesetzt – Nachrücker: ${names.join(", ")}.`;
  return `Nicht erschienen gesetzt – ${moved.length === 1 ? "1 Person rückt" : `${moved.length} Personen rücken`} von der Warteliste nach.`;
}
