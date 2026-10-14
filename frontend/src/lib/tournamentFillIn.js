// Nachrücker nach dem Check-in-Ende (#1551): wo die Person im Baum gelandet ist - Antwortfeld `placement` des Servers.

export function placementMessage(placement) {
  if (!placement) return null;
  if (!placement.ok) return { tone: "warning", text: placement.detail || "Im Turnierbaum ist kein Platz frei." };
  return placement.kind === "bye"
    ? { tone: "success", text: "Rückt auf einen Platz mit Freilos nach – dieses Spiel wird jetzt gespielt." }
    : { tone: "success", text: "Rückt auf den Platz einer Person „Nicht erschienen“ nach." };
}
