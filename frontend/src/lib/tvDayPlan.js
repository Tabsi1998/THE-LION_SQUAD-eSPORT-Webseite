// Hallen-Tafel (#1126): der Tagesplan des Events als Zeitleiste mit „jetzt“-Linie - Turniere und Fast Laps mit ihren
// Zeiten, dazu der Einlass. Bei mehrtägigen Events (#884) zählt der Tag, der gerade läuft (sonst der nächste, nach dem
// Event der letzte): „Tag 2 von 3 · Samstag“. Ein Tag darf über Mitternacht gehen (Sa 20:00 – 02:00); was nach
// Mitternacht beginnt, gehört dann noch zum Samstag. Der freie Programm-Text hat keine Uhrzeiten und bleibt draußen.
// Darunter: was jetzt läuft und was als Nächstes kommt, mit Uhrzeit und Hinweis („Check-in ab 14:00 bei der
// Turnierleitung“). Alles reine Rechnung - die Uhr gibt die Seite herein, die „jetzt“-Linie rückt jede Minute weiter.
import { asInstant, viennaDate, viennaDay, viennaTime } from "@/lib/vienna";

const HOUR = 3600000;
const LIVE_TOURNAMENT = new Set(["live", "paused", "check_in", "checkin_open"]);
const DONE_TOURNAMENT = new Set(["completed", "results_published", "archived", "cancelled"]);
const LIVE_FASTLAP = new Set(["live", "active", "running"]);
const DONE_FASTLAP = new Set(["completed", "results_published", "finished", "archived", "cancelled"]);
const DEFAULT_LENGTH = 3 * HOUR;

function timeOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = typeof value === "number" ? value : asInstant(value).getTime();
  return Number.isNaN(time) ? null : time;
}

export function clockText(time) {
  return viennaTime(time, { hour: "2-digit", minute: "2-digit" });
}

function weekday(time) {
  return viennaDate(time, { weekday: "long" });
}

/** Die Tage des Events: bei mehreren Tagen aus den Event-Tagen, sonst ein Tag aus Beginn und Ende. */
export function eventDays(event, items = []) {
  const raw = (event?.schedule?.days?.length ? event.schedule.days : event?.days) || [];
  const multi = raw
    .map((day) => ({ date: day.date, startAt: timeOf(day.start_at), endAt: timeOf(day.end_at), doorAt: timeOf(day.door_at), title: day.title || "" }))
    .filter((day) => day.startAt !== null && day.endAt !== null)
    .sort((a, b) => a.startAt - b.startAt);
  if (multi.length >= 2) return multi.map((day, index) => ({ ...day, index, count: multi.length }));
  const starts = items.map((item) => item.from).filter((time) => time !== null);
  const ends = items.map((item) => item.to ?? item.from).filter((time) => time !== null);
  const startAt = timeOf(event?.start_date) ?? (starts.length ? Math.min(...starts) : null);
  if (startAt === null) return [];
  const endAt = timeOf(event?.end_date) ?? Math.max(startAt + 10 * HOUR, ...ends.map((time) => time + HOUR));
  return [{ date: viennaDay(startAt), startAt, endAt, doorAt: timeOf(event?.door_time), title: "", index: 0, count: 1 }];
}

/** Der Tag, der jetzt zählt: der laufende, sonst der nächste, nach dem Event der letzte. */
export function pickDay(days, now = Date.now()) {
  if (!days.length) return null;
  const running = days.find((day) => (day.doorAt ?? day.startAt) <= now && now < day.endAt);
  if (running) return { day: running, state: "running" };
  const upcoming = days.find((day) => now < (day.doorAt ?? day.startAt));
  if (upcoming) return { day: upcoming, state: upcoming.index === 0 ? "before" : "break" };
  return { day: days[days.length - 1], state: "after" };
}

/** An welchem Tag etwas läuft: im Zeitfenster des Tages (ab Einlass), sonst am selben Kalendertag. */
export function dayIndexOf(days, instant) {
  const time = timeOf(instant);
  if (time === null) return -1;
  const inside = days.find((day) => (day.doorAt ?? day.startAt) <= time && time < day.endAt);
  if (inside) return inside.index;
  const date = viennaDay(time);
  const same = days.find((day) => day.date === date);
  return same ? same.index : -1;
}

function tournamentState(item, now) {
  const status = String(item.status || "").toLowerCase();
  if (DONE_TOURNAMENT.has(status)) return "past";
  if (LIVE_TOURNAMENT.has(status)) return "live";
  if (item.to !== null && now >= item.to) return "past";
  return "upcoming";
}

function fastLapState(item, now) {
  const status = String(item.status || "").toLowerCase();
  if (DONE_FASTLAP.has(status)) return "past";
  if (item.to !== null && now >= item.to) return "past";
  if (LIVE_FASTLAP.has(status) || (item.from !== null && now >= item.from && (item.to === null || now < item.to))) return "live";
  return "upcoming";
}

/** Turniere und Fast Laps als Einträge mit Zeit - ohne Uhrzeit kommen sie nicht in die Zeitleiste. */
export function planItems(event) {
  const items = [];
  for (const tournament of event?.tournaments || []) {
    const from = timeOf(tournament.start_date);
    if (from === null) continue;
    items.push({ id: `t-${tournament.id}`, kind: "tournament", source: tournament, title: tournament.title || tournament.name || "Turnier", status: tournament.status, from, to: timeOf(tournament.end_date) });
  }
  for (const challenge of event?.f1_challenges || []) {
    const from = timeOf(challenge.start_date);
    if (from === null) continue;
    items.push({ id: `f-${challenge.id}`, kind: "fastlap", source: challenge, title: challenge.title || challenge.name || "Fast Lap", status: challenge.status, from, to: timeOf(challenge.end_date) });
  }
  return items.sort((a, b) => a.from - b.from || a.title.localeCompare(b.title, "de"));
}

function hint(item, now) {
  const source = item.source || {};
  if (item.kind === "fastlap") return `${item.timeText} · Fast Lap`;
  const status = String(source.status || "").toLowerCase();
  const checkFrom = timeOf(source.check_in_from);
  const checkUntil = timeOf(source.check_in_until);
  if (status === "paused") {
    const until = timeOf(source.paused_until);
    return until && until > now ? `Kurze Pause · weiter um ${clockText(until)}` : "Kurze Pause";
  }
  if (status === "check_in" || status === "checkin_open" || (checkFrom !== null && checkFrom <= now && (checkUntil === null || now <= checkUntil) && now < item.from)) {
    return checkUntil ? `Check-in läuft bis ${clockText(checkUntil)} bei der Turnierleitung` : "Check-in läuft bei der Turnierleitung";
  }
  if (checkFrom !== null && checkFrom > now) return `Check-in ab ${clockText(checkFrom)} bei der Turnierleitung`;
  if (status === "registration_open") return "Anmeldung offen";
  return item.timeText;
}

/**
 * Der Tagesplan für die Hallen-Tafel: Tag, Zeitraum mit Stunden-Strichen, Bahnen (Turniere, Fast Lap) mit Blöcken,
 * „jetzt“-Linie (Anteil 0 bis 1, außerhalb `null`), was läuft und was als Nächstes kommt.
 */
export function dayPlan(event, now = Date.now()) {
  const all = planItems(event);
  const days = eventDays(event, all);
  const picked = pickDay(days, now);
  if (!picked) return null;
  const { day, state } = picked;
  const items = all.filter((item) => (days.length > 1 ? dayIndexOf(days, item.from) === day.index : true));
  const door = day.doorAt;
  const starts = [day.startAt, door, ...items.map((item) => item.from)].filter((time) => time !== null);
  const from = Math.floor(Math.min(...starts) / HOUR) * HOUR;
  // Ohne Ende: bis zum nächsten Eintrag derselben Bahn, sonst drei Stunden - nie über das Tagesende hinaus.
  const lanes = { tournament: [], fastlap: [] };
  for (const item of items) lanes[item.kind].push(item);
  const blocks = [];
  for (const [kind, list] of Object.entries(lanes)) {
    list.forEach((item, index) => {
      const next = list.slice(index + 1).find((other) => other.from > item.from);
      const open = item.to === null;
      const to = open ? Math.min(next ? next.from : item.from + DEFAULT_LENGTH, Math.max(day.endAt, item.from + HOUR)) : item.to;
      const live = kind === "fastlap" ? fastLapState({ ...item, to }, now) : tournamentState({ ...item, to: open ? null : to }, now);
      blocks.push({ ...item, to, open, state: live, timeText: open ? `ab ${clockText(item.from)}` : `${clockText(item.from)}–${clockText(to)}` });
    });
  }
  const ends = [day.endAt, ...blocks.map((block) => block.to)].filter((time) => time !== null);
  const to = Math.ceil(Math.max(...ends) / HOUR) * HOUR;
  const span = Math.max(HOUR, to - from);
  const step = span <= 10 * HOUR ? HOUR : span <= 20 * HOUR ? 2 * HOUR : 3 * HOUR;
  const ticks = [];
  for (let tick = from; tick <= to; tick += step) ticks.push(tick);
  const upcoming = blocks.filter((block) => block.state === "upcoming").sort((a, b) => a.from - b.from);
  if (upcoming[0]) upcoming[0].state = "next";
  const running = blocks.filter((block) => block.state === "live");
  const share = now >= from && now <= to ? (now - from) / span : null;
  const multi = days.length > 1;
  return {
    day,
    state,
    multi,
    title: multi ? `Tag ${day.index + 1} von ${day.count} · ${weekday(day.startAt)}` : `${weekday(day.startAt)}, ${viennaDate(day.startAt, { day: "numeric", month: "long" })}`,
    weekday: weekday(day.startAt),
    from,
    to,
    ticks: ticks.map((tick) => ({ at: tick, share: (tick - from) / span, label: clockText(tick) })),
    lanes: [
      { key: "tournament", label: "Turniere", blocks: blocks.filter((block) => block.kind === "tournament") },
      { key: "fastlap", label: "Fast Lap", blocks: blocks.filter((block) => block.kind === "fastlap") },
    ].filter((lane) => lane.blocks.length),
    door: door !== null && door >= from ? { at: door, share: (door - from) / span, label: `Einlass ${clockText(door)}` } : null,
    now: share === null ? null : { at: now, share, label: clockText(now) },
    running: running.map((block) => ({ ...block, hint: hint(block, now) })),
    next: upcoming[0] ? { ...upcoming[0], hint: hint(upcoming[0], now) } : null,
    startsText: state === "before" || state === "break" ? `${multi ? `Tag ${day.index + 1} beginnt` : "Beginn"} ${viennaDay(day.doorAt ?? day.startAt) === viennaDay(now) ? "um" : `${weekday(day.doorAt ?? day.startAt)} um`} ${clockText(day.doorAt ?? day.startAt)}` : "",
  };
}

/**
 * Blöcke einer Bahn in Reihen, damit sich nichts überdeckt - `minShare` ist die kleinste Breite, die ein Block im Bild
 * braucht (so viel Platz, dass sein Name lesbar ist). Gibt je Block die Reihe zurück und wie viele Reihen es sind.
 */
export function packLane(blocks, plan, minShare = 0, minShareOf = null) {
  const span = Math.max(1, plan.to - plan.from);
  const rowsEnd = [];
  const placed = blocks.map((block) => {
    const left = (block.from - plan.from) / span;
    const width = Math.max(minShareOf ? minShareOf(block) : minShare, (block.to - block.from) / span);
    const end = left + width;
    let row = rowsEnd.findIndex((rowEnd) => rowEnd <= left + 1e-9);
    if (row === -1) {
      row = rowsEnd.length;
      rowsEnd.push(end);
    } else rowsEnd[row] = end;
    return { ...block, left, width: Math.min(width, 1 - left), row };
  });
  return { blocks: placed, rows: Math.max(1, rowsEnd.length) };
}
