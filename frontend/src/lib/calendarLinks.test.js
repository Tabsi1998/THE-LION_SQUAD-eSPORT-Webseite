import { calendarWindow, downloadIcs, googleCalendarUrl, icsFileName, icsFor, outlookCalendarUrl, serverIcsPath } from "./calendarLinks";

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

test("Outlook-Link und die ICS vom Server (#580)", () => {
  const outlook = outlookCalendarUrl(item);
  expect(outlook).toContain("https://outlook.live.com/calendar/0/deeplink/compose?");
  expect(outlook).toContain("startdt=2026-12-12T17%3A00%3A00.000Z");
  expect(outlook).toContain("enddt=2026-12-12T19%3A00%3A00.000Z");
  expect(outlook).toContain("subject=Weihnachtsfeier%2C+Vereinsheim");
  expect(outlook).toContain("location=Vereinsheim%3B+Telfs");
  expect(outlookCalendarUrl({ ...item, start: null })).toBe("");
  expect(serverIcsPath({ ...item, slug: "weihnachtsfeier" })).toBe("/api/calendar/events/weihnachtsfeier.ics");
  expect(serverIcsPath({ id: "t1", kind: "tournament" })).toBe("/api/calendar/tournaments/t1.ics");
  expect(serverIcsPath({ id: "f1", kind: "fastlap" })).toBe("");
  expect(serverIcsPath({ kind: "event" })).toBe("");
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
