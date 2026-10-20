import { offlineLabel } from "./network";

// Der Stand in der Offline-Leiste (#1058): heute nur die Uhrzeit, sonst mit Tag - Daten von gestern dürfen nicht
// aussehen wie Daten von vor fünf Minuten. Wiener Zeit (21.10.2026 ist Sommerzeit, UTC+2).

const now = new Date("2026-10-21T10:00:00Z"); // Mi 21. Oktober, 12:00 in Wien

test("ohne Stand nur „Offline“", () => {
  expect(offlineLabel(null, now)).toBe("Offline");
});

test("heute nur die Uhrzeit", () => {
  expect(offlineLabel(Date.parse("2026-10-21T08:05:00Z"), now)).toBe("Offline · Stand 10:05");
  // Kurz nach Mitternacht in Wien ist es schon heute, obwohl UTC noch gestern ist.
  expect(offlineLabel(Date.parse("2026-10-20T22:30:00Z"), now)).toBe("Offline · Stand 00:30");
});

test("gestern mit dem Wort „gestern“", () => {
  expect(offlineLabel(Date.parse("2026-10-20T12:05:00Z"), now)).toBe("Offline · Stand gestern 14:05");
});

test("älter mit Wochentag und Datum", () => {
  expect(offlineLabel(Date.parse("2026-10-18T12:05:00Z"), now)).toBe("Offline · Stand So 18. Oktober · 14:05");
});
