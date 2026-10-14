import { placementMessage } from "./tournamentFillIn";

// Nachrücker nach dem Check-in-Ende (#1551): die Verwaltung sagt in einem Satz, wo die Person im Baum gelandet ist.

test("Platz einer Person „Nicht erschienen“, Platz mit Freilos, kein Platz frei", () => {
  expect(placementMessage({ ok: true, kind: "no_show" })).toEqual({ tone: "success", text: "Rückt auf den Platz einer Person „Nicht erschienen“ nach." });
  expect(placementMessage({ ok: true, kind: "bye" })).toEqual({ tone: "success", text: "Rückt auf einen Platz mit Freilos nach – dieses Spiel wird jetzt gespielt." });
  expect(placementMessage({ ok: false, detail: "Im Turnierbaum ist kein Platz frei." })).toEqual({ tone: "warning", text: "Im Turnierbaum ist kein Platz frei." });
  expect(placementMessage(null)).toBeNull();
});
