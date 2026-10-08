import { applicationState } from "./applicationState";

// Bewerbungen (#1356): jeder Stand als Satz mit dem nächsten Schritt - Website, Dolibarr und Unbekanntes, nie ein Rohwert.

const day = (value) => `${value.slice(8, 10)}.${value.slice(5, 7)}.${value.slice(0, 4)}`;

test("Anträge auf der Website: offen heißt annehmen oder ablehnen, entschieden mit Datum", () => {
  expect(applicationState({ coupled: false, status: "pending" }, day)).toEqual(expect.objectContaining({ label: "Offen", next: "Annehmen oder ablehnen – hier auf der Website.", decide: true }));
  expect(applicationState({ coupled: false, status: "approved", decided_at: "2026-10-05T10:00:00+00:00" }, day).next).toBe("Aufgenommen am 05.10.2026.");
  expect(applicationState({ coupled: false, status: "rejected", decided_at: "2026-10-06T10:00:00+00:00" }, day).next).toBe("Abgelehnt am 06.10.2026.");
});

test("Anträge über Dolibarr: dort entscheiden, hier erscheint es von selbst - keine Knöpfe", () => {
  const waiting = applicationState({ coupled: true, status: "pending", dolibarr: { application_status: "received" } }, day);
  expect(waiting).toEqual(expect.objectContaining({ label: "Wartet auf Dolibarr", next: "Dort annehmen oder ablehnen – hier erscheint es von selbst.", decide: false }));
  expect(applicationState({ coupled: true, status: "pending", dolibarr: { application_status: "in_review" } }, day).label).toBe("In Prüfung in Dolibarr");
  expect(applicationState({ coupled: true, status: "approved", decided_at: "2026-10-07T10:00:00+00:00", dolibarr: { application_status: "accepted" } }, day).next).toBe("In Dolibarr aufgenommen am 07.10.2026.");
  expect(applicationState({ coupled: true, status: "submitting", dolibarr: {} }, day).label).toBe("Wird übermittelt");
});

test("ein unbekannter Stand erscheint nie roh", () => {
  const unknown = applicationState({ coupled: true, status: "pending", dolibarr: { application_status: "waiting_payment" } }, day);
  expect(unknown.label).toBe("Stand aus Dolibarr unbekannt");
  expect(`${unknown.label} ${unknown.next}`).not.toContain("waiting_payment");
  expect(applicationState({ coupled: false, status: "parked" }, day).label).toBe("Stand unbekannt");
});
