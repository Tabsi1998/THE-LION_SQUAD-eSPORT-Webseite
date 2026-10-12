import * as SecureStore from "expo-secure-store";
import type { CalendarItem } from "./calendar";
import { WEB_BASE_URL } from "./siteUrls";
import { asInstant } from "./vienna";

// Versammlungen und eigene Helferschichten als Termin (#1272, #1190) - dieselbe Rechnung wie im Web
// (frontend/src/lib/clubCalendar.js) und am Server (services/club_calendar.py): ohne Namen anderer, ohne Zugangslink.

const HOUR_MS = 60 * 60 * 1000;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^\d{2}:\d{2}/;

export type MeetingLike = { id: number; kind_label?: string; title?: string; day?: string; time?: string; place?: string; format_label?: string };
export type ShiftEventLike = { id: number; label?: string; day?: string; place?: string };
export type ShiftLike = { id: number; label?: string; day?: string; start?: string; end?: string };

function wallTime(day?: string, clock?: string): Date | null {
  if (!DAY.test(String(day || "")) || !CLOCK.test(String(clock || ""))) return null;
  const date = asInstant(`${day}T${String(clock).slice(0, 5)}`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function meetingTitle(meeting: MeetingLike): string {
  const kind = meeting.kind_label || "Versammlung";
  const title = String(meeting.title || "").trim();
  if (!title) return kind;
  return title.toLowerCase().includes(kind.toLowerCase()) ? title : `${kind}: ${title}`;
}

/** Eine Sitzung als Termin - ohne Uhrzeit ein ganzer Tag. */
export function meetingCalendarItem(meeting: MeetingLike | null | undefined): CalendarItem | null {
  if (!meeting?.id || !DAY.test(String(meeting.day || ""))) return null;
  const start = wallTime(meeting.day, meeting.time);
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
    url: `${WEB_BASE_URL}/members/meetings?meeting=${meeting.id}`,
  };
}

/** Eine eigene Schicht als Termin - endet sie vor dem Beginn, geht sie über Mitternacht. */
export function shiftCalendarItem(event: ShiftEventLike | null | undefined, shift: ShiftLike | null | undefined): CalendarItem | null {
  const day = shift?.day || event?.day;
  const start = wallTime(day, shift?.start);
  if (!event?.id || !shift?.id || !start) return null;
  let end = wallTime(day, shift.end);
  if (end && end.getTime() <= start.getTime()) end = new Date(end.getTime() + 24 * HOUR_MS);
  return {
    id: `shift-${event.id}-${shift.id}`,
    kind: "club",
    title: `Helferschicht: ${shift.label || "Dienst"}${event.label ? ` · ${event.label}` : ""}`,
    start: start.toISOString(),
    end: end ? end.toISOString() : null,
    day,
    location: event.place || null,
    detail: "Helferdienst – Details im Mitgliederbereich",
    url: `${WEB_BASE_URL}/members/helfen?event=${event.id}`,
  };
}

// „Im Kalender eintragen?“ nach einer Zusage genau einmal je Termin und Gerät.
const ASKED_KEY = "tls.calendar-asked";

async function askedList(): Promise<string[]> {
  try {
    const parsed = JSON.parse((await SecureStore.getItemAsync(ASKED_KEY)) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => typeof entry === "string") : [];
  } catch {
    return [];
  }
}

export async function calendarAskDue(key: string): Promise<boolean> {
  return Boolean(key) && !(await askedList()).includes(key);
}

export async function rememberCalendarAsked(key: string): Promise<void> {
  if (!key) return;
  try {
    const list = (await askedList()).filter((entry) => entry !== key);
    await SecureStore.setItemAsync(ASKED_KEY, JSON.stringify([...list, key].slice(-100)));
  } catch {
    // ohne Speicher fragt die App beim nächsten Mal wieder
  }
}
