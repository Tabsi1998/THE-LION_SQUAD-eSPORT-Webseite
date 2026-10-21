import { checkInWindow, placeLine, rulesSummary, waitlistLead } from "@/lib/registrationSheet";

// Voller Cup (#1941, F4): das Blatt sagt, dass die Anmeldung auf die Warteliste geht - mit dem Platz, wenn der Server
// die Länge der Warteliste mitschickt.
test("waitlistLead: bei vollem Cup die Warteliste mit Platz, sonst leer", () => {
  expect(waitlistLead({ max_participants: 16, participant_count: 16, waitlist_count: 2 })).toBe("Der Cup ist voll – du kommst auf die Warteliste (Platz 3).");
  expect(waitlistLead({ max_participants: 16, participant_count: 17, waitlist_count: 0 })).toBe("Der Cup ist voll – du kommst auf die Warteliste (Platz 1).");
  expect(waitlistLead({ max_participants: 16, participant_count: 16 })).toBe("Der Cup ist voll – du kommst auf die Warteliste.");
  expect(waitlistLead({ max_participants: 16, participant_count: 15, waitlist_count: 0 })).toBe("");
  expect(waitlistLead({ participant_count: 40 })).toBe("");
  expect(waitlistLead(null)).toBe("");
});

// Bestätigungs-Blatt der Turnier-Anmeldung (#1261): die Zusammenfassung aus den Turnierdaten.

const NOW = new Date("2026-05-20T10:00:00Z");

test("Regeln in drei Sätzen - aus Markdown, ohne Listenzeichen; ohne Regeln leer", () => {
  expect(rulesSummary("## Regeln\n- Fair Play gilt immer.\n- Ergebnisse meldet der **Sieger**!\n- Zu spät heißt verloren? Ja.\n- Rest.")).toBe(
    "Fair Play gilt immer. Ergebnisse meldet der Sieger! Zu spät heißt verloren?",
  );
  expect(rulesSummary("Nur ein Satz ohne Punkt")).toBe("Nur ein Satz ohne Punkt");
  expect(rulesSummary("")).toBe("");
  expect(rulesSummary(null)).toBe("");
});

test("sehr lange Regeln werden am Wort gekürzt", () => {
  const long = `${"Wort ".repeat(120)}.`;
  const text = rulesSummary(long);
  expect(text.length).toBeLessThanOrEqual(281);
  expect(text.endsWith("…")).toBe(true);
});

test("Check-in-Fenster: am selben Tag mit Bis-Uhrzeit, sonst beide Zeitpunkte, ohne Angabe leer", () => {
  expect(checkInWindow({ check_in_from: "2026-05-23T18:00:00Z", check_in_until: "2026-05-23T18:45:00Z" }, NOW)).toBe("Sa 23. Mai · 20:00–20:45");
  expect(checkInWindow({ check_in_from: "2026-05-23T18:00:00Z", check_in_until: "2026-05-24T08:00:00Z" }, NOW)).toBe("Sa 23. Mai · 20:00 – So 24. Mai · 10:00");
  expect(checkInWindow({ check_in_from: "2026-05-23T18:00:00Z" }, NOW)).toBe("ab Sa 23. Mai · 20:00");
  expect(checkInWindow({ check_in_until: "2026-05-23T18:45:00Z" }, NOW)).toBe("bis Sa 23. Mai · 20:45");
  expect(checkInWindow({}, NOW)).toBe("");
});

test("Ort: online, vor Ort mit Adresse, beides", () => {
  expect(placeLine({ event_mode: "online" })).toBe("Online");
  expect(placeLine({})).toBe("Online");
  expect(placeLine({ event_mode: "local", location: "Halle" })).toBe("Vor Ort · Halle");
  expect(placeLine({ event_mode: "local" })).toBe("Vor Ort");
  expect(placeLine({ event_mode: "hybrid", location: "Halle" })).toBe("Online und vor Ort · Halle");
});
