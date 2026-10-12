// Kalender (#216): Monatsraster, Termine je Tag und „In meinen Kalender“ - reine Rechnung ohne
// Netz und ohne native Module, damit sie sich testen lässt. Ein Tag ist ein Kalendertag in Wien
// („JJJJ-MM-TT“) - wie die Uhrzeit daneben; die Termine kommen als ISO-Zeit mit Zone. Das Raster
// selbst ist reine Kalenderrechnung.
import { viennaDay } from "./vienna";

// „club“ (#1190, #1272): Versammlungen und eigene Helferschichten - nur für Mitglieder, in der Farbe des Vereins.
export type CalendarKind = "event" | "tournament" | "fastlap" | "club";

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
  /** Ein ganzer Tag (Versammlung ohne Uhrzeit) - `day` ist dann der Kalendertag „JJJJ-MM-TT“. */
  allDay?: boolean;
  day?: string | null;
  /** Vereinstermine (#1190): der Weg in den Mitgliederbereich, z. B. „/members/meetings?meeting=7“. */
  path?: string | null;
};

/** „JJJJ-MM-TT“ und der Tag danach - am Kalender gezählt, für ganze Tage. */
export function allDayRange(item: Pick<CalendarItem, "allDay" | "day">): { from: string; to: string } | null {
  if (!item.allDay || !/^\d{4}-\d{2}-\d{2}$/.test(String(item.day || ""))) return null;
  const [year, month, day] = String(item.day).split("-").map(Number);
  return { from: String(item.day), to: new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10) };
}

export type CalendarCell = { key: string; day: number; inMonth: boolean; date: Date };

const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
// Ein Termin, der länger dauert, belegt höchstens so viele Tage - ein offenes Ende füllt sonst das Jahr.
const MAX_SPAN_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;

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

/** Die Wiener Tage, die ein Termin berührt - offene Enden gekappt. */
function coveredDays(item: CalendarItem): string[] {
  const start = parseIso(item.start);
  if (!start) return [];
  const end = parseIso(item.end) || start;
  const cursor = parseDay(viennaDay(start));
  const last = parseDay(viennaDay(end));
  const keys: string[] = [];
  while (cursor.getTime() <= last.getTime() && keys.length < MAX_SPAN_DAYS) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

/** Termine je Tag - ein mehrtägiger Termin steht an jedem Tag, den er berührt. */
export function itemsByDay(items: CalendarItem[]): Map<string, CalendarItem[]> {
  const map = new Map<string, CalendarItem[]>();
  for (const item of items) {
    for (const key of coveredDays(item)) {
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return map;
}

/** Der Monat, in dem der Kalender aufgeht (#1271): der aktuelle, in Wien gezählt - wie im Web. */
export function currentMonth(now: Date = new Date()): { year: number; month: number } {
  const [year, month] = viennaDay(now).split("-").map(Number);
  return { year, month: month - 1 };
}

export type CalendarSpan = CalendarItem & { days: string[] };
export type CalendarBar = { item: CalendarSpan; from: number; to: number; lane: number; continuesBefore: boolean; continuesAfter: boolean };

/** Mehrtägig (#1271) heißt mindestens 24 Stunden über mehrere Tage - eine Nachtschicht bis 1 Uhr ist es nicht. */
function isMultiDay(item: CalendarItem): boolean {
  const start = parseIso(item.start);
  const end = parseIso(item.end);
  return Boolean(start && end && end.getTime() - start.getTime() >= DAY_MS && coveredDays(item).length > 1);
}

/**
 * Mehrtägiges wird ein Balken (mit seinen Tagen), alles andere bleibt ein Punkt am Tag - dieselbe Rechnung wie im Web.
 * Einträge mit derselben Art und Kennung sind die Tage eines Events (Codex-Prüfung #1460): ein Termin, dessen Balken nur
 * die echten Tage belegt - eine Lücke dazwischen teilt ihn.
 */
export function splitSpans(items: CalendarItem[]): { spans: CalendarSpan[]; singles: CalendarItem[] } {
  const spans: CalendarSpan[] = [];
  const singles: CalendarItem[] = [];
  const groups = new Map<string, CalendarItem[]>();
  for (const item of items) {
    const key = `${item.kind}-${item.id}`;
    groups.set(key, [...(groups.get(key) || []), item]);
  }
  const startOf = (item: CalendarItem) => parseIso(item.start)?.getTime() ?? 0;
  const endOf = (item: CalendarItem) => parseIso(item.end)?.getTime() ?? startOf(item);
  for (const parts of groups.values()) {
    if (parts.length > 1) {
      const sorted = [...parts].sort((a, b) => startOf(a) - startOf(b));
      const last = sorted.reduce((latest, part) => (endOf(part) > endOf(latest) ? part : latest), sorted[0]);
      const days = Array.from(new Set(sorted.flatMap(coveredDays))).sort();
      if (days.length > 1) {
        spans.push({ ...sorted[0], end: last.end || last.start, mine: sorted.some((part) => part.mine), days });
        continue;
      }
    }
    for (const item of parts) {
      if (isMultiDay(item)) spans.push({ ...item, days: coveredDays(item) });
      else singles.push(item);
    }
  }
  spans.sort((a, b) => startOf(a) - startOf(b));
  return { spans, singles };
}

function shiftDay(key: string, delta: number): string {
  const date = parseDay(key);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

/** Die Balken einer Woche: Spalten 0-6, davor/danach weiter, überlappende in eigenen Reihen (höchstens `maxLanes`). */
export function weekBars(week: CalendarCell[], spans: CalendarSpan[], maxLanes = 3): CalendarBar[] {
  const runs: Omit<CalendarBar, "lane">[] = [];
  for (const item of spans) {
    const days = new Set(item.days);
    let col = 0;
    while (col < week.length) {
      if (!days.has(week[col].key)) {
        col += 1;
        continue;
      }
      const from = col;
      while (col < week.length && days.has(week[col].key)) col += 1;
      const to = col - 1;
      runs.push({ item, from, to, continuesBefore: days.has(shiftDay(week[from].key, -1)), continuesAfter: days.has(shiftDay(week[to].key, 1)) });
    }
  }
  const startOf = (item: CalendarItem) => parseIso(item.start)?.getTime() ?? 0;
  runs.sort((a, b) => a.from - b.from || startOf(a.item) - startOf(b.item) || (b.to - b.from) - (a.to - a.from));
  const laneEnds: number[] = [];
  const placed: CalendarBar[] = [];
  for (const run of runs) {
    let lane = laneEnds.findIndex((end) => end < run.from);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(run.to);
    } else {
      laneEnds[lane] = run.to;
    }
    if (lane < maxLanes) placed.push({ ...run, lane });
  }
  return placed;
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
  const allDay = allDayRange(item);
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: item.title,
    dates: allDay ? `${allDay.from.replace(/-/g, "")}/${allDay.to.replace(/-/g, "")}` : `${icsStamp(window.start)}/${icsStamp(window.end)}`,
  });
  const details = [item.detail, item.url].filter(Boolean).join("\n");
  if (details) params.set("details", details);
  if (item.location) params.set("location", item.location);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}
