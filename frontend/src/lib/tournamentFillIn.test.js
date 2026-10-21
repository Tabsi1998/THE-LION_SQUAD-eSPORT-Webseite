import { checkinStatusText, placementMessage } from "./tournamentFillIn";

// Nachrücker nach dem Check-in-Ende (#1551): die Verwaltung sagt in einem Satz, wo die Person im Baum gelandet ist.

test("Platz einer Person „Nicht erschienen“, Platz mit Freilos, kein Platz frei", () => {
  expect(placementMessage({ ok: true, kind: "no_show" })).toEqual({ tone: "success", text: "Rückt auf den Platz einer Person „Nicht erschienen“ nach." });
  expect(placementMessage({ ok: true, kind: "bye" })).toEqual({ tone: "success", text: "Rückt auf einen Platz mit Freilos nach – dieses Spiel wird jetzt gespielt." });
  expect(placementMessage({ ok: false, detail: "Im Turnierbaum ist kein Platz frei." })).toEqual({ tone: "warning", text: "Im Turnierbaum ist kein Platz frei." });
  expect(placementMessage(null)).toBeNull();
});

// „Nicht erschienen“ mit Nachrücken (#1941, F9): die Meldung nennt, wer von der Warteliste nachgerückt ist.
const REGS = [
  { id: "r-paul", display_name: "PistenPaul", status: "approved" },
  { id: "r-bea", display_name: "Begleitung Bea", status: "waitlist" },
  { id: "r-zoe", ingame_name: "ZickZackZoe", status: "waitlist" },
];

test("Nicht erschienen mit Nachrücker: „… – Nachrücker: Name“", () => {
  expect(checkinStatusText("no_show", { waitlist_moved_up: ["r-bea"] }, REGS)).toBe("Nicht erschienen gesetzt – Nachrücker: Begleitung Bea.");
  expect(checkinStatusText("no_show", { waitlist_moved_up: ["r-bea", "r-zoe"] }, REGS)).toBe("Nicht erschienen gesetzt – Nachrücker: Begleitung Bea, ZickZackZoe.");
  expect(checkinStatusText("no_show", { waitlist_moved_up: ["r-unbekannt"] }, REGS)).toBe("Nicht erschienen gesetzt – 1 Person rückt von der Warteliste nach.");
});

test("ohne Nachrücker und die anderen Check-in-Schritte wie bisher", () => {
  expect(checkinStatusText("no_show", { waitlist_moved_up: [] }, REGS)).toBe("Nicht erschienen gesetzt.");
  expect(checkinStatusText("no_show", null, REGS)).toBe("Nicht erschienen gesetzt.");
  expect(checkinStatusText("checked_in", {}, REGS)).toBe("Check-in gesetzt.");
  expect(checkinStatusText("approved", {}, REGS)).toBe("Check-in zurückgenommen.");
});
