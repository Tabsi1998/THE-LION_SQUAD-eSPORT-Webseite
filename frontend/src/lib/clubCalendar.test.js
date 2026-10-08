import { calendarAskDue, meetingCalendarItem, meetingTitle, rememberCalendarAsked, shiftCalendarItem } from "./clubCalendar";
import { googleCalendarUrl, outlookCalendarUrl, serverIcsPath } from "./calendarLinks";

// Versammlungen und eigene Schichten als Termin (#1272): Wiener Zeit, ganzer Tag ohne Uhrzeit, über Mitternacht,
// die Datei vom Server - und „Im Kalender eintragen?“ genau einmal je Termin.

test("eine Versammlung um 18 Uhr Wiener Zeit, zwei Stunden lang, Datei nur über den eigenen Weg", () => {
  const item = meetingCalendarItem({ id: 7, kind_label: "Generalversammlung", title: "Generalversammlung 2026", day: "2026-10-24", time: "18:00", place: "Vereinsheim" });
  expect(item.title).toBe("Generalversammlung 2026");
  expect(item.start).toBe("2026-10-24T16:00:00.000Z");
  expect(item.end).toBe("2026-10-24T18:00:00.000Z");
  expect(item.allDay).toBe(false);
  expect(serverIcsPath(item)).toBe("/api/calendar/meetings/7.ics");
  expect(item.url).toMatch(/\/members\/meetings\?meeting=7$/);
  expect(meetingTitle({ kind_label: "Vorstandssitzung", title: "Oktober" })).toBe("Vorstandssitzung: Oktober");
});

test("ohne Uhrzeit ein ganzer Tag - auch bei Google und Outlook", () => {
  const item = meetingCalendarItem({ id: 3, kind_label: "Generalversammlung", title: "", day: "2027-03-31", time: "" });
  expect(item.allDay).toBe(true);
  expect(item.title).toBe("Generalversammlung");
  expect(decodeURIComponent(googleCalendarUrl(item))).toContain("dates=20270331/20270401");
  const outlook = new URL(outlookCalendarUrl(item));
  expect(outlook.searchParams.get("allday")).toBe("true");
  expect(outlook.searchParams.get("startdt")).toBe("2027-03-31");
  expect(outlook.searchParams.get("enddt")).toBe("2027-04-01");
  expect(meetingCalendarItem({ id: 4, day: "bald" })).toBeNull();
});

test("eine Schicht über Mitternacht endet am Folgetag; ohne Beginn kein Termin", () => {
  const event = { id: 5, label: "Sommerfest 2026", day: "2026-10-10", place: "Vereinsheim" };
  const item = shiftCalendarItem(event, { id: 52, label: "Bar", day: "2026-10-10", start: "22:00", end: "01:00" });
  expect(item.title).toBe("Helferschicht: Bar · Sommerfest 2026");
  expect(item.start).toBe("2026-10-10T20:00:00.000Z");
  expect(item.end).toBe("2026-10-10T23:00:00.000Z");
  expect(serverIcsPath(item)).toBe("/api/calendar/shifts/5/52.ics");
  expect(shiftCalendarItem(event, { id: 53, label: "Abbau", start: "" })).toBeNull();
});

test("„Im Kalender eintragen?“ einmal je Termin; ohne Speicher wird gefragt", () => {
  const store = new Map();
  const storage = { getItem: (key) => store.get(key) ?? null, setItem: (key, value) => store.set(key, value) };
  expect(calendarAskDue("meeting-7", storage)).toBe(true);
  rememberCalendarAsked("meeting-7", storage);
  expect(calendarAskDue("meeting-7", storage)).toBe(false);
  expect(calendarAskDue("shift-5-52", storage)).toBe(true);
  const broken = { getItem: () => { throw new Error("gesperrt"); }, setItem: () => { throw new Error("gesperrt"); } };
  expect(calendarAskDue("meeting-7", broken)).toBe(true);
  expect(() => rememberCalendarAsked("meeting-7", broken)).not.toThrow();
});
