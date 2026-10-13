import { formatRange, formatWhen } from "@/lib/datetime";
import { asInstant, dayNoon, viennaDate, viennaDay, viennaTime } from "@/lib/vienna";
// Kalender auf der Website (#402): Monatsraster, Termine je Tag und der Abo-Link - dieselbe
// Rechnung wie in der App (mobile/src/lib/calendar.ts), ohne React, damit sie sich testen lässt.
// Ein Tag ist ein Kalendertag in Wien („JJJJ-MM-TT“) - wie die Uhrzeit daneben; die Termine kommen vom Server
// als ISO-Zeit mit Zone. Das Raster selbst ist reine Kalenderrechnung.

export const WEEKDAY_LABELS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];
const MONTHS = ["Jänner", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
// Ein Termin, der länger dauert, belegt höchstens so viele Tage - ein offenes Ende füllt sonst das Jahr.
const MAX_SPAN_DAYS = 31;
const DAY_MS = 24 * 60 * 60 * 1000;
// Am Handy startet die Liste (#1271) - schmaler als das, was Tailwind „sm“ nennt.
const PHONE_MAX_WIDTH = 639;
export const VIEW_STORAGE_KEY = "tls_calendar_view";

// „club“ (#1190): Versammlungen und die eigenen Helferschichten - nur für Mitglieder, in Vereinsgold (#1305).
export const KIND_LABELS = { event: "Event", tournament: "Turnier", fastlap: "Fast Lap", club: "Verein" };
// Farben je Art: eine Stelle für Website und App (#1151, categoryColors.js).
export { KIND_COLORS } from "@/lib/categoryColors";
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
  const date = asInstant(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Die Wiener Tage, die ein Termin berührt - offene Enden gekappt. */
function coveredDays(item) {
  const start = parseIso(item.start);
  if (!start) return [];
  const end = parseIso(item.end) || start;
  const cursor = parseDay(viennaDay(start));
  const last = parseDay(viennaDay(end));
  const keys = [];
  while (cursor.getTime() <= last.getTime() && keys.length < MAX_SPAN_DAYS) {
    keys.push(dayKey(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return keys;
}

function startTime(item) {
  return parseIso(item.start)?.getTime() ?? Infinity;
}

const byStart = (a, b) => startTime(a) - startTime(b);

/** Termine je Tag - ein mehrtägiger Termin steht an jedem Tag, den er berührt. */
export function itemsByDay(items) {
  const map = new Map();
  for (const item of items || []) {
    for (const key of coveredDays(item)) {
      const list = map.get(key) || [];
      list.push(item);
      map.set(key, list);
    }
  }
  for (const list of map.values()) list.sort((a, b) => a.start.localeCompare(b.start));
  return map;
}

/** Der Monat, in dem der Kalender aufgeht (#1271): der aktuelle, in Wien gezählt. */
export function currentMonth(now = new Date()) {
  const [year, month] = viennaDay(now).split("-").map(Number);
  return { year, month: month - 1 };
}

/**
 * Die Tage eines mehrtägigen Events (#884) als ein Termin (#1271): der Name des Events, Beginn des ersten und Ende
 * des letzten Tags, „angemeldet“, wenn einer es ist. `parts` behält die Tage für Balken mit Lücken.
 */
export function mergeEventDays(items) {
  const groups = new Map();
  const out = [];
  for (const item of items || []) {
    if (item.marker !== "event_day" || !item.event_id) {
      out.push(item);
      continue;
    }
    const group = groups.get(item.event_id);
    if (!group) {
      const merged = { ...item, id: item.event_id, title: item.event_name || item.title, marker: null, parts: [item] };
      groups.set(item.event_id, merged);
      out.push(merged);
      continue;
    }
    group.parts.push(item);
    if (startTime(item) < startTime(group)) group.start = item.start;
    const itemEnd = parseIso(item.end || item.start);
    const groupEnd = parseIso(group.end || group.start);
    if (itemEnd && (!groupEnd || itemEnd.getTime() > groupEnd.getTime())) group.end = item.end || item.start;
    group.mine = Boolean(group.mine || item.mine);
  }
  return out.sort(byStart);
}

/** Mehrtägig heißt: mehrere Tage eines Events oder mindestens 24 Stunden - eine Nachtschicht bis 1 Uhr ist es nicht. */
function isMultiDay(item) {
  if (item.parts) return item.parts.length > 1;
  const start = parseIso(item.start);
  const end = parseIso(item.end);
  return Boolean(start && end && end.getTime() - start.getTime() >= DAY_MS && coveredDays(item).length > 1);
}

/** Mehrtägiges wird ein Balken (mit seinen Tagen), alles andere bleibt ein Punkt am Tag. */
export function splitSpans(items) {
  const spans = [];
  const singles = [];
  for (const item of mergeEventDays(items)) {
    if (isMultiDay(item)) {
      const days = Array.from(new Set((item.parts || [item]).flatMap(coveredDays))).sort();
      spans.push({ ...item, days });
    } else {
      singles.push(...(item.parts || [item]));
    }
  }
  return { spans, singles };
}

function shiftDay(key, delta) {
  const date = parseDay(key);
  date.setDate(date.getDate() + delta);
  return dayKey(date);
}

/**
 * Die Balken einer Woche (#1271): je Termin die Spalten 0-6, die er durchgehend belegt, und ob er davor oder danach
 * weitergeht. Überlappende Balken bekommen eigene Reihen (`lane`); was über `maxLanes` hinausgeht, zeigt der Tag selbst.
 */
export function weekBars(week, spans, maxLanes = 3) {
  const runs = [];
  for (const item of spans || []) {
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
  runs.sort((a, b) => a.from - b.from || startTime(a.item) - startTime(b.item) || (b.to - b.from) - (a.to - a.from));
  const laneEnds = [];
  const placed = [];
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

function isUpcoming(item, now) {
  const start = parseIso(item.start);
  if (!start) return false;
  const end = parseIso(item.end) || start;
  return end.getTime() >= now.getTime();
}

/** Die Liste (#1271): alle kommenden Termine nach Datum, nach Monat gruppiert; Laufendes steht im aktuellen Monat. */
export function agenda(items, now = new Date()) {
  const today = viennaDay(now);
  const groups = [];
  for (const item of mergeEventDays(items).filter((entry) => isUpcoming(entry, now))) {
    const startDay = viennaDay(parseIso(item.start));
    const key = (startDay < today ? today : startDay).slice(0, 7);
    let group = groups.find((entry) => entry.key === key);
    if (!group) {
      const [year, month] = key.split("-").map(Number);
      group = { key, label: monthLabel(year, month - 1), items: [] };
      groups.push(group);
    }
    group.items.push(item);
  }
  return groups.sort((a, b) => a.key.localeCompare(b.key));
}

/** Ist der Monat leer, der nächste Termin danach - für „Nächster Termin: …“ mit Sprung dorthin (#1271). */
export function nextAfter(items, year, month) {
  const prefix = `${year}-${String(month + 1).padStart(2, "0")}`;
  const merged = mergeEventDays(items);
  if (merged.some((item) => (item.parts || [item]).flatMap(coveredDays).some((key) => key.startsWith(prefix)))) return null;
  return merged.find((item) => parseIso(item.start) && viennaDay(parseIso(item.start)) > `${prefix}-32`) || null;
}

/** Der erste Tag eines Termins: „Do 11. März“ - in einem anderen Jahr mit Jahr (#1307). */
export function startPhrase(item, now = new Date()) {
  const start = parseIso(item?.start);
  return start ? formatRange(start, null, { now }) : "";
}

/**
 * Wann, in einer Zeile (#1271, #1307 - lib/datetime.js): mehrtägig „Do 11. – So 14. März“, ganztägig „Fr 12. März ·
 * ganztägig“, sonst „Sa 23. Mai · 18:00“ oder „heute 18:00“.
 */
export function spanLabel(item, now = new Date()) {
  const start = parseIso(item?.start);
  if (!start) return "";
  if (item.all_day) return `${formatRange(item.day ? dayNoon(item.day) : start, null, { now })} · ganztägig`;
  if (!isMultiDay(item)) return formatWhen(start, { now });
  return formatRange(start, parseIso(item.end) || start, { now });
}

/** Liste oder Monat (#1271): die letzte Wahl am Gerät, sonst am Handy die Liste. */
export function preferredView(stored, width) {
  if (stored === "list" || stored === "month") return stored;
  return Number(width) > 0 && Number(width) <= PHONE_MAX_WIDTH ? "list" : "month";
}

/** Was als Nächstes ansteht: läuft noch oder beginnt später - nach Beginn, begrenzt; die Tage eines Events als eine Zeile. */
export function upcomingItems(items, now = new Date(), limit = 8) {
  return mergeEventDays(items).filter((item) => isUpcoming(item, now)).slice(0, limit);
}

export function filterKinds(items, kinds) {
  const wanted = new Set(kinds);
  return (items || []).filter((item) => wanted.has(item.kind));
}

/** „Nur meine“ (#1189): nur, wofür man selbst oder das eigene Team angemeldet ist - der Server setzt `mine`. */
export function filterMine(items, onlyMine) {
  return onlyMine ? (items || []).filter((item) => item.mine) : items || [];
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
  return viennaTime(date, { hour: "2-digit", minute: "2-digit" });
}

export function dayLabel(key) {
  return viennaDate(dayNoon(key), { weekday: "long", day: "numeric", month: "long" });
}
