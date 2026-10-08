import { asInstant } from "@/lib/vienna";

// Versammlungen und eigene Helferschichten im Kalender (#1272, #1190): dieselben Termine wie am Server
// (services/club_calendar.py) - Titel ohne Namen anderer, ohne Zugangslink; die Kalender-Datei kommt vom Server und
// gibt es nur für die Person selbst. Dieselbe Rechnung steht für die App in mobile/src/lib/clubCalendar.ts.

const HOUR_MS = 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}/;

function wallTime(day, clock) {
  if (!DAY.test(String(day || "")) || !CLOCK.test(String(clock || ""))) return null;
  const date = asInstant(`${day}T${String(clock).slice(0, 5)}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function siteUrl(path) {
  return typeof window !== "undefined" ? `${window.location.origin}${path}` : path;
}

export function meetingTitle(meeting) {
  const kind = meeting?.kind_label || "Versammlung";
  const title = String(meeting?.title || "").trim();
  if (!title) return kind;
  return title.toLowerCase().includes(kind.toLowerCase()) ? title : `${kind}: ${title}`;
}

/** Eine Sitzung als Termin für „In den Kalender“ - ohne Uhrzeit ein ganzer Tag. */
export function meetingCalendarItem(meeting) {
  if (!meeting?.id || !DAY.test(String(meeting.day || ""))) return null;
  const start = wallTime(meeting.day, meeting.time);
  const path = `/members/meetings?meeting=${meeting.id}`;
  return {
    id: `meeting-${meeting.id}`,
    kind: "club",
    title: meetingTitle(meeting),
    start: (start || asInstant(`${meeting.day}T00:00`)).toISOString(),
    end: start ? new Date(start.getTime() + 2 * HOUR_MS).toISOString() : null,
    allDay: !start,
    day: meeting.day,
    location: meeting.place || meeting.format_label || null,
    detail: "Versammlung – Details im Mitgliederbereich",
    url: siteUrl(path),
    icsPath: `/api/calendar/meetings/${meeting.id}.ics`,
  };
}

/** Eine eigene Schicht als Termin - endet sie vor dem Beginn, geht sie über Mitternacht. */
export function shiftCalendarItem(event, shift) {
  const day = shift?.day || event?.day;
  const start = wallTime(day, shift?.start);
  if (!event?.id || !shift?.id || !start) return null;
  let end = wallTime(day, shift.end);
  if (end && end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * HOUR_MS);
  const path = `/members/helfen?event=${event.id}`;
  return {
    id: `shift-${event.id}-${shift.id}`,
    kind: "club",
    title: `Helferschicht: ${shift.label || "Dienst"}${event.label ? ` · ${event.label}` : ""}`,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    day,
    location: event.place || null,
    detail: "Helferdienst – Details im Mitgliederbereich",
    url: siteUrl(path),
    icsPath: `/api/calendar/shifts/${event.id}/${shift.id}.ics`,
  };
}

// „Im Kalender eintragen?“ fragt die Seite nach einer Zusage genau einmal je Termin und Gerät. Ohne Speicher (privates
// Fenster) fragt sie eben jedes Mal - das schadet nicht.
const ASKED_KEY = "tls-calendar-asked";

function askedList(storage) {
  try {
    const list = JSON.parse(storage?.getItem(ASKED_KEY) || "[]");
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

export function calendarAskDue(key, storage = typeof window !== "undefined" ? window.localStorage : null) {
  return Boolean(key) && !askedList(storage).includes(key);
}

export function rememberCalendarAsked(key, storage = typeof window !== "undefined" ? window.localStorage : null) {
  if (!key) return;
  try {
    const list = askedList(storage).filter((entry) => entry !== key);
    storage?.setItem(ASKED_KEY, JSON.stringify([...list, key].slice(-100)));
  } catch {
    // Ohne Speicher bleibt nichts gemerkt.
  }
}
