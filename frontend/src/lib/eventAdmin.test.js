import {
  affectedRegistrations, cancelConfirmText, deleteConfirmText, eventIsOver, eventLastDay, savedEventMessage,
  touchesScheduleOrPlace, visibilityWord,
} from "@/lib/eventAdmin";

// Absagen, Verschieben, Löschen (#2118): Rückfragen mit Zahl und ehrliche Texte.
test("Betroffene: Angemeldete (samt Eingecheckten) und Warteliste", () => {
  expect(affectedRegistrations({ registration_summary: { registered_count: 4, waitlist_count: 2 } })).toBe(6);
  expect(affectedRegistrations({})).toBe(0);
  // Die Verwaltungsliste zählt alle bestehenden Anmeldungen - auch bei ausgeschalteter Anmeldung (Zusammenfassung leer).
  expect(affectedRegistrations({ active_registration_count: 3, registration_summary: { registered_count: 0 } })).toBe(3);
  expect(affectedRegistrations({ active_registration_count: 0, registration_summary: { registered_count: 2 } })).toBe(0);
});

test("Rückfrage beim Absagen nennt die Zahl in Einzahl und Mehrzahl", () => {
  expect(cancelConfirmText(0)).toContain("Niemand ist angemeldet");
  expect(cancelConfirmText(1)).toContain("1 Anmeldung (samt Warteliste)");
  expect(cancelConfirmText(5)).toContain("5 Anmeldungen (samt Warteliste)");
  expect(cancelConfirmText(5)).toContain("storniert");
  expect(cancelConfirmText(5)).toContain("neu anmelden");
});

test("Termin oder Ort geändert: nur diese Felder zählen", () => {
  expect(touchesScheduleOrPlace({ start_date: "2026-11-14T10:00" })).toBe(true);
  expect(touchesScheduleOrPlace({ locations: [] })).toBe(true);
  expect(touchesScheduleOrPlace({ city: "Innsbruck" })).toBe(true);
  expect(touchesScheduleOrPlace({ description: "neu", max_participants: 10 })).toBe(false);
});

test("Rückmeldung nach dem Speichern: Absage mit Zahlen, sonst schlicht", () => {
  expect(savedEventMessage({ cancellation: { registrations: 3, notified: 2, orders: 1 } }))
    .toBe("Event abgesagt: 3 Anmeldungen storniert, 2 Personen benachrichtigt, 1 Rechnungsauftrag storniert.");
  expect(savedEventMessage({ change_notice: { notified: 1 } })).toBe("Gespeichert. 1 Person benachrichtigt.");
  expect(savedEventMessage({})).toBe("Gespeichert.");
});

test("Löschen sagt ehrlich, was passiert", () => {
  expect(deleteConfirmText({ name: "Herbst-LAN" })).toContain("endgültig");
  expect(deleteConfirmText({ name: "Herbst-LAN", registration_summary: { registered_count: 2 } })).toContain("zuerst absagen");
});

// Eventliste (#1373): „Rückblick schreiben“ erst nach dem letzten Tag in Wien - wie der Server (event_recap.is_over).

test("eintägig: am Tag selbst noch nicht vorbei, ab dem nächsten Wiener Tag schon", () => {
  const event = { status: "scheduled", start_date: "2026-11-14T18:00:00+01:00", end_date: "2026-11-14T23:30:00+01:00" };
  expect(eventIsOver(event, new Date("2026-11-14T22:59:00Z"))).toBe(false);
  // 23:30 UTC ist in Wien schon der 15. - der Tag ist vorbei.
  expect(eventIsOver(event, new Date("2026-11-14T23:30:00Z"))).toBe(true);
});

test("mehrtägig: zählt der letzte Tag, nicht der erste", () => {
  const event = {
    status: "live",
    start_date: "2026-10-16T16:00:00+00:00",
    days: [{ end_at: "2026-10-16T21:00:00+00:00" }, { end_at: "2026-10-18T14:00:00+00:00" }],
  };
  expect(eventLastDay(event)).toBe("2026-10-18");
  expect(eventIsOver(event, new Date("2026-10-17T12:00:00Z"))).toBe(false);
  expect(eventIsOver(event, new Date("2026-10-18T20:00:00Z"))).toBe(false);
  expect(eventIsOver(event, new Date("2026-10-18T22:30:00Z"))).toBe(true);
});

test("Status: beendet zählt sofort, abgesagt nie, ohne Termin nicht", () => {
  const future = { start_date: "2099-01-01T10:00:00Z" };
  expect(eventIsOver({ ...future, status: "completed" })).toBe(true);
  expect(eventIsOver({ status: "cancelled", start_date: "2020-01-01T10:00:00Z" })).toBe(false);
  expect(eventIsOver({ status: "draft" })).toBe(false);
});

test("Sichtbarkeit in Worten: aus der Server-Liste, sonst Ersatz - nie der Rohwert", () => {
  const meta = [{ k: "public", l: "Öffentlich", short: "Alle" }, { k: "members", l: "Nur Vereinsmitglieder" }];
  expect(visibilityWord("public", meta)).toBe("Alle");
  expect(visibilityWord("members", meta)).toBe("Mitglieder");
  expect(visibilityWord("community", [])).toBe("Community");
  expect(visibilityWord("internal")).toBe("Intern");
  expect(visibilityWord("SECRET", [])).toBe("Unbekannt");
});
