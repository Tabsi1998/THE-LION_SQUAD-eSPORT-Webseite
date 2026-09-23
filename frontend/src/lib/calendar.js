// Kalender auf der Website (#402): Monatsraster, Termine je Tag und der Abo-Link - dieselbe
// Rechnung wie in der App (mobile/src/lib/calendar.ts), ohne React, damit sie sich testen lässt.
// Tage sind lokale Gerätetage; die Termine kommen vom Server als ISO-Zeit mit Zone.

export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
// Ein Termin, der länger dauert, belegt höchstens so viele Tage - ein offenes Ende füllt sonst das Jahr.
const MAX_SPAN_DAYS = 31;

export const KIND_LABELS = { event: "Event", tournament: "Turnier", fastlap: "Fast Lap" };
export const KIND_COLORS = { event: "#9F7AEA", tournament: "#FFD700", fastlap: "#29B6E8" };
export const KINDS = Object.keys(KIND_LABELS);

export function dayKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function parseDay(key) {
  const [year, month, day] = String(key).split("-").map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

export function monthLabel(year, month) {
  return `${MONTHS[month]} ${year}`;
}

export function shiftMonth(year, month, delta) {
  const date = new Date(year, month + delta, 1);
  return { year: date.getFullYear(), month: date.getMonth() };
}

/** Sechs Wochen ab Montag - Tage des Vormonats und Folgemonats füllen die Ränder. */
export function monthMatrix(year, month) {
  const first = new Date(year, month, 1);
  const offset = (first.getDay() + 6) % 7;
  const cursor = new Date(year, month, 1 - offset);
  const weeks = [];
  for (let week = 0; week < 6; week += 1) {
    const row = [];
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

function parseIso(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Termine je Tag - ein mehrtägiger Termin steht an jedem Tag, den er berührt. */
export function itemsByDay(items) {
  const map = new Map();
  for (const item of items || []) {
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
export function initialMonth(items, now = new Date()) {
  const upcoming = (items || [])
    .map((item) => parseIso(item.start))
    .filter((date) => date && date.getTime() >= now.getTime())
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const anchor = upcoming || now;
  return { year: anchor.getFullYear(), month: anchor.getMonth() };
}

/** Was als Nächstes ansteht: läuft noch oder beginnt später - nach Beginn, begrenzt. */
export function upcomingItems(items, now = new Date(), limit = 8) {
  return (items || [])
    .filter((item) => {
      const start = parseIso(item.start);
      if (!start) return false;
      const end = parseIso(item.end) || start;
      return end.getTime() >= now.getTime();
    })
    .sort((a, b) => a.start.localeCompare(b.start))
    .slice(0, limit);
}

export function filterKinds(items, kinds) {
  const wanted = new Set(kinds);
  return (items || []).filter((item) => wanted.has(item.kind));
}

/** Die Abo-Adressen: https für Kopieren und Google, webcal für „im Kalender öffnen“. */
export function feedUrls(origin, feedPath = "/api/calendar/feed.ics") {
  const base = String(origin || "").replace(/\/+$/, "");
  const https = `${base}${feedPath}`;
  return { https, webcal: https.replace(/^https?:\/\//, "webcal://") };
}

export function timeLabel(value) {
  const date = parseIso(value);
  if (!date) return "";
  return date.toLocaleTimeString("de-AT", { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(key) {
  return parseDay(key).toLocaleDateString("de-AT", { weekday: "long", day: "numeric", month: "long" });
}
