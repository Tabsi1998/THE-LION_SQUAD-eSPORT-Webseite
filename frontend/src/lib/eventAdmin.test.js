import { eventIsOver, eventLastDay, visibilityWord } from "@/lib/eventAdmin";

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
