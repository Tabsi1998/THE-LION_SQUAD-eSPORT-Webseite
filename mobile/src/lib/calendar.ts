// Kalender (#216): Monatsraster, Termine je Tag und „In meinen Kalender“ - reine Rechnung ohne
// Netz und ohne native Module, damit sie sich testen lässt. Tage sind lokale Gerätetage; Verein
// und Mitglieder sind in Wien, die Termine kommen als ISO-Zeit mit Zone.

export type CalendarKind = "event" | "tournament" | "fastlap";

export type CalendarItem = {
  id: string;
  kind: CalendarKind;
  title: string;
  start: string;
  end?: string | null;
  mine?: boolean;
  location?: string | null;
  detail?: string | null;
  url?: string | null;
};

export type CalendarCell = { key: string; day: number; inMonth: boolean; date: Date };

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
// Ein Termin, der länger dauert, belegt höchstens so viele Tage - ein offenes Ende füllt sonst das Jahr.
const MAX_SPAN_DAYS = 31;

export const WEEKDAY_LABELS = WEEKDAYS;

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDay(key: string): Date {
  const [year, month, day] = key.split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function monthLabel(year: number, month: number): string {
  return `${MONTHS[month]} ${year}`;
}

export function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** Sechs Wochen ab Montag - Tage des Vormonats und Folgemonats füllen die Ränder. */
export function monthMatrix(year: number, month: number): CalendarCell[][] {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const cursor = new Date(year, month, 1 - offset);
  const weeks: CalendarCell[][] = [];
  for (let week = 0; week < 6; week += 1) {
    const row: CalendarCell[] = [];
    for (let day = 0; day < 7; day += 1) {
      const date = new Date(cursor);
      row.push({ key: dayKey(date), day: date.getDate(), inMonth: date.getMonth() === month, date });
      cursor.setDate(cursor.getDate() + 1);
    }
    weeks.push(row);
    if (week >= 3 && cursor.getMonth() !== month) break;
  }
  return weeks;
}

function parseIso(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Termine je Tag - ein mehrtägiger Termin steht an jedem Tag, den er berührt. */
export function itemsByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const start = parseIso(item.start);
    if (!start) continue;
    const end = parseIso(item.end) || start;
    const cursor = new Date(start.getFullYear(), start.getMonth(), start.getDate());
    const last = new Date(end.getFullYear(), end.getMonth(), end.getDate());
    let steps = 0;
    while (cursor.getTime() <= last.getTime() && steps < MAX_SPAN_DAYS) {
      const key = dayKey(cursor);
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
      cursor.setDate(cursor.getDate() + 1);
      steps += 1;
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return map;
}

/** Der Monat, in dem der Kalender aufgeht: der nächste Termin, sonst heute. */
export function initialMonth(items: CalendarItem[], now: Date = new Date()): { year: number; month: number } {
  const upcoming = items
    .map((item) => parseIso(item.start))
    .filter((date): date is Date => Boolean(date) && (date as Date).getTime() >= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const anchor = upcoming || now;
  return { year: anchor.getFullYear(), month: anchor.getMonth() };
}

// ---------------------------------------------------------------- „In meinen Kalender“

function icsStamp(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function icsText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/[,;]/g, (match) => `\\${match}`);
}

export function calendarWindow(item: Pick<CalendarItem, "start" | "end">): { start: Date; end: Date } | null {
  const start = parseIso(item.start);
  if (!start) return null;
  const end = parseIso(item.end);
  // Ohne Ende: zwei Stunden - ein Termin braucht eine Dauer, damit er im Kalender sichtbar ist.
  return { start, end: end && end.getTime() > start.getTime() ? end : new Date(start.getTime() + 2 * 60 * 60 * 1000) };
}

export function icsFor(item: CalendarItem, now: Date = new Date()): string {
  const window = calendarWindow(item);
  if (!window) return "";
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//THE LION SQUAD//LionsAPP//DE", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${item.kind}-${item.id}@lionsquad.at`,
    `DTSTAMP:${icsStamp(now)}`,
    `DTSTART:${icsStamp(window.start)}`,
    `DTEND:${icsStamp(window.end)}`,
    `SUMMARY:${icsText(item.title)}`,
  ];
  if (item.detail) lines.push(`DESCRIPTION:${icsText(item.detail)}`);
  if (item.location) lines.push(`LOCATION:${icsText(item.location)}`);
  if (item.url) lines.push(`URL:${item.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return `${lines.join("\r\n")}\r\n`;
}

export function googleCalendarUrl(item: CalendarItem): string {
  const window = calendarWindow(item);
  if (!window) return "";
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: `${icsStamp(window.start)}/${icsStamp(window.end)}`,
  });
  const details = [item.detail, item.url].filter(Boolean).join("\n");
  if (details) params.set("details", details);
  if (item.location) params.set("location", item.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
