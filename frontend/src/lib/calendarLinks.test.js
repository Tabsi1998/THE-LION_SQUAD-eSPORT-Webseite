import { calendarWindow, downloadIcs, googleCalendarUrl, icsFileName, icsFor } from "./calendarLinks";

// „In meinen Kalender“ im Web (#216): .ics und Google-Link mit Zeitfenster, Ort und Text.

const item = { id: "e1", kind: "event", title: "Weihnachtsfeier, Vereinsheim", start: "2026-12-12T18:00:00+01:00", location: "Vereinsheim; Telfs", detail: "Vereinsevent", url: "https://lionsquad.at/events/weihnachtsfeier" };
const BACKSLASH = String.fromCharCode(92);

test("ohne Ende dauert der Termin zwei Stunden; Sonderzeichen sind maskiert", () => {
  const window = calendarWindow(item);
  expect(window.end.getTime() - window.start.getTime()).toBe(2 * 60 * 60 * 1000);
  const ics = icsFor(item, new Date("2026-09-22T10:00:00Z"));
  expect(ics).toContain("DTSTART:20261212T170000Z");
  expect(ics).toContain(`SUMMARY:Weihnachtsfeier${BACKSLASH}, Vereinsheim`);
  expect(ics).toContain(`LOCATION:Vereinsheim${BACKSLASH}; Telfs`);
  expect(ics).toContain("URL:https://lionsquad.at/events/weihnachtsfeier");
  expect(googleCalendarUrl(item)).toContain("dates=20261212T170000Z%2F20261212T190000Z");
  expect(icsFileName(item)).toBe("weihnachtsfeier-vereinsheim.ics");
  expect(icsFor({ ...item, start: null })).toBe("");
});

test("der Download hängt einen Blob-Link an, klickt ihn und räumt auf", () => {
  const clicked = [];
  const link = { href: "", download: "", click: () => clicked.push(link.download), remove: () => {} };
  const doc = { createElement: () => link, body: { appendChild: () => {} } };
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  URL.createObjectURL = () => "blob:x";
  URL.revokeObjectURL = () => {};
  try {
    expect(downloadIcs(item, doc)).toBe(true);
    expect(clicked).toEqual(["weihnachtsfeier-vereinsheim.ics"]);
    expect(downloadIcs({ ...item, start: null }, doc)).toBe(false);
  } finally {
    URL.createObjectURL = original.create;
    URL.revokeObjectURL = original.revoke;
  }
});
