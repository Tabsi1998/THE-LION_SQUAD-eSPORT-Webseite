import { calendarAskDue, meetingCalendarItem, meetingTitle, rememberCalendarAsked, shiftCalendarItem } from "./clubCalendar";
import { allDayRange, googleCalendarUrl } from "./calendar";

// Versammlungen und eigene Schichten als Termin (#1272): Wiener Zeit, ganzer Tag ohne Uhrzeit, über Mitternacht,
// und „Im Kalender eintragen?“ genau einmal je Termin - wie im Web.

test("Versammlung um 18 Uhr Wiener Zeit, zwei Stunden; ohne Uhrzeit ein ganzer Tag", () => {
  const item = meetingCalendarItem({ id: 7, kind_label: "Generalversammlung", title: "Generalversammlung 2026", day: "2026-10-24", time: "18:00", place: "Vereinsheim" });
  expect(item?.title).toBe("Generalversammlung 2026");
  expect(item?.kind).toBe("club");
  expect(item?.start).toBe("2026-10-24T16:00:00.000Z");
  expect(item?.end).toBe("2026-10-24T18:00:00.000Z");
  expect(item?.url).toMatch(/\/members\/meetings\?meeting=7$/);
  const whole = meetingCalendarItem({ id: 3, kind_label: "Generalversammlung", title: "", day: "2027-03-31", time: "" });
  expect(whole?.allDay).toBe(true);
  expect(allDayRange(whole!)).toEqual({ from: "2027-03-31", to: "2027-04-01" });
  expect(decodeURIComponent(googleCalendarUrl(whole!))).toContain("dates=20270331/20270401");
  expect(meetingTitle({ id: 4, kind_label: "Vorstandssitzung", title: "Oktober" })).toBe("Vorstandssitzung: Oktober");
  expect(meetingCalendarItem({ id: 4, day: "bald" })).toBeNull();
});

test("Schicht über Mitternacht endet am Folgetag; ohne Beginn kein Termin", () => {
  const event = { id: 5, label: "Sommerfest 2026", day: "2026-10-10", place: "Vereinsheim" };
  const item = shiftCalendarItem(event, { id: 52, label: "Bar", day: "2026-10-10", start: "22:00", end: "01:00" });
  expect(item?.title).toBe("Helferschicht: Bar · Sommerfest 2026");
  expect(item?.start).toBe("2026-10-10T20:00:00.000Z");
  expect(item?.end).toBe("2026-10-10T23:00:00.000Z");
  expect(shiftCalendarItem(event, { id: 53, label: "Abbau", start: "" })).toBeNull();
});

test("„Im Kalender eintragen?“ einmal je Termin", async () => {
  expect(await calendarAskDue("meeting-99")).toBe(true);
  await rememberCalendarAsked("meeting-99");
  expect(await calendarAskDue("meeting-99")).toBe(false);
  expect(await calendarAskDue("shift-5-99")).toBe(true);
});
