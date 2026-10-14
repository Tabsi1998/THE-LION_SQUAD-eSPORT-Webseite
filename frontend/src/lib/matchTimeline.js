import { effectiveMatchDuration } from "@/lib/matchDuration";
import { finderFor, sourceLabel } from "@/lib/slotSource";
import { advancementModeOf, drawGroupOf, slotDrawn } from "@/lib/bracketGraph";

// Matchplan-Seite (#1557): die Zeitleiste je Station. Hier wird nichts geplant - Zeit, Station und Warnungen kommen
// vom Spielplaner (POST …/schedule/plan, services/match_scheduler.py) oder stehen gespeichert am Spiel. Diese Datei
// legt sie nur auf eine Achse: Position = Zeit, Breite = Dauer (dieselbe Kette wie der Planer, lib/matchDuration.js),
// Farbe = Abschnitt und Zustand, Konflikte aus den Warnungen des Planers und aus Überschneidungen auf einer Bahn.

const MINUTE = 60_000;
export const NO_STATION = "none";
export const FIXED_SOURCES = new Set(["manual", "accepted"]);
const DONE = new Set(["completed", "forfeit", "archived", "no_show", "disputed"]);
const SKIPPED = new Set(["cancelled", "bye"]);
const RUNNING = new Set(["in_progress", "running", "waiting_result"]);
const FINAL_SECTIONS = new Set(["GF", "FINAL", "grand_final", "final"]);
const LOSER_SECTIONS = new Set(["LB", "loser", "losers"]);

/**
 * Weiterkommen in vier Modi (#1590): wartet das Spiel auf ein Los je Runde? `ready` - Show, der Topf steht;
 * `waiting` - noch nicht alle Quellspiele fertig bzw. noch nicht gelost; `instant` - Plätze füllen sich einzeln, der
 * Termin ist nur Prognose; sonst `null`. Mit Plan zählt die Antwort des Planers, ohne Plan das Spiel selbst.
 */
export function drawStateOf(match, assignment = null) {
  if (assignment && ("waiting_for_draw" in assignment || "draw_ready" in assignment)) {
    if (assignment.draw_ready) return "ready";
    if (assignment.waiting_for_draw) return "waiting";
  }
  const group = drawGroupOf(match);
  if (!group) return null;
  const mode = advancementModeOf(match);
  if (mode === "instant") return (match.slots || []).some((slot) => slot?.status === "pending" && !slotDrawn(slot)) ? "instant" : null;
  if (match.draw && typeof match.draw === "object") return null;
  if ((match.slots || []).some(slotDrawn)) return null;
  return match.draw_ready && typeof match.draw_ready === "object" ? "ready" : "waiting";
}

function instant(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Abschnitt als Farbrolle: Winner Bracket Marke, Loser Bracket Violett, Finale Gold-frei (eigene Fläche), sonst neutral. */
export function sectionTone(section) {
  if (FINAL_SECTIONS.has(section)) return "final";
  if (LOSER_SECTIONS.has(section)) return "lb";
  if (section === "WB" || section === "winner") return "wb";
  return "main";
}

/** Auf `step` Minuten einrasten (Ziehen, Tastatur). */
export function snapMinutes(ms, step = 5) {
  const size = step * MINUTE;
  return Math.round(ms / size) * size;
}

function floorTo(ms, minutes) {
  const size = minutes * MINUTE;
  return Math.floor(ms / size) * size;
}

function ceilTo(ms, minutes) {
  const size = minutes * MINUTE;
  return Math.ceil(ms / size) * size;
}

function playersOf(match, registrations, findIn) {
  const names = new Map((registrations || []).map((reg) => [reg.id, reg.display_name || reg.ingame_name || ""]));
  return (match.slots || [])
    .filter((slot) => slot && slot.status !== "bye" && slot.source?.type !== "bye")
    .map((slot) => names.get(slot.registration_id) || sourceLabel(slot.source, findIn(match)) || "noch offen");
}

function stateOf(match) {
  const status = String(match.status || "");
  if (DONE.has(status) || (match.completed_at && !RUNNING.has(status))) return "done";
  if (RUNNING.has(status) || match.started_at) return "running";
  return "planned";
}

/**
 * Baut die Zeitleiste. `plan` ist die Vorschau des Planers (oder null): ihre Zuordnungen überdecken, was gespeichert
 * ist; ihre Warnungen werden zu Konflikten am Spiel. `now` braucht der Live-Teil (laufende Spiele wachsen bis jetzt).
 */
export function buildTimeline({ matches = [], stations = [], stages = [], tournament = null, game = null, registrations = [],
  plan = null, now = new Date() } = {}) {
  const nowMs = instant(now instanceof Date ? now.getTime() : now) ?? Date.now();
  // Wie der Planer: echte Spiele, sonst (Baum noch Vorschau) die Vorschau - die hat keine Zeit und steht nur in der Liste.
  const all = (matches || []).filter(Boolean);
  const real = all.filter((match) => !match.is_preview);
  const rows = real.length ? real : all;
  const stageById = new Map((stages || []).map((stage) => [stage?.id, stage]));
  const assignments = new Map((plan?.assignments || []).map((item) => [item.match_id, item]));
  const findIn = finderFor(rows);
  const stationById = new Map((stations || []).filter(Boolean).map((station) => [station.id, station]));
  const keyById = new Map(rows.map((match) => [match.id, match.match_key || match.round_name || "Spiel"]));

  const items = [];
  const unscheduled = [];
  for (const match of rows) {
    if (SKIPPED.has(String(match.status || ""))) continue;
    const assignment = assignments.get(match.id);
    const state = stateOf(match);
    const minutes = assignment?.duration_minutes
      || effectiveMatchDuration(match, { stage: stageById.get(match.stage_id), tournament, game });
    let start = instant(assignment?.scheduled_at);
    if (state !== "planned" || start === null) start = instant(match.started_at) ?? instant(match.scheduled_at) ?? start;
    const stationId = (assignment && state === "planned" ? assignment.station_id : match.station_id) || null;
    const item = {
      id: match.id,
      key: keyById.get(match.id),
      label: match.match_key || match.round_name || "Spiel",
      round: match.round,
      roundName: match.round_name || "",
      section: match.section || "",
      tone: sectionTone(match.section),
      status: match.status,
      state,
      minutes,
      start,
      end: null,
      laneId: stationId || NO_STATION,
      stationId,
      preview: Boolean(match.is_preview),
      fixed: FIXED_SOURCES.has(match.schedule_source),
      source: match.schedule_source || null,
      forecast: assignment ? Boolean(assignment.forecast) : Boolean(match.schedule_forecast),
      draw: state === "planned" ? drawStateOf(match, assignment) : null,
      changed: Boolean(assignment?.changed),
      previous: assignment?.changed ? { start: instant(assignment.previous?.scheduled_at), stationId: assignment.previous?.station_id || null } : null,
      elapsedMinutes: null,
      names: playersOf(match, registrations, findIn),
      conflicts: [],
    };
    if (start === null) {
      unscheduled.push(item);
      continue;
    }
    if (state === "done") {
      // Gespielt von Start bis Ende - ohne Startzeit weiß niemand, wann wirklich gespielt wurde: dann gilt die geplante
      // Zeit mit ihrer Dauer, nicht der Moment, in dem jemand das Ergebnis eingetragen hat.
      const done = match.started_at ? instant(match.completed_at) : null;
      item.end = Math.max(done ?? start + minutes * MINUTE, start + MINUTE);
    } else if (state === "running") {
      item.end = Math.max(start + minutes * MINUTE, nowMs);
      item.elapsedMinutes = Math.max(0, Math.floor((nowMs - start) / MINUTE));
    } else {
      item.end = start + minutes * MINUTE;
    }
    items.push(item);
  }

  const byId = new Map(items.map((item) => [item.id, item]));
  for (const warning of plan?.warnings || []) {
    const item = byId.get(warning.match_id);
    if (!item) continue;
    item.conflicts.push({ type: warning.type, otherKey: keyById.get(warning.other_match_id) || null, text: warning.message || "Konflikt" });
  }

  const laneName = (id) => {
    if (id === NO_STATION) return "Ohne Station";
    const fromPlan = (plan?.assignments || []).find((row) => row.station_id === id)?.station_name;
    return stationById.get(id)?.name || fromPlan || "Station";
  };
  // Überschneidungen auf einer Bahn (gespeicherte Zeiten oder nach dem Ziehen): beide Spiele sind rot.
  const lanesSeen = new Map();
  for (const item of items) {
    // Vergangenes ist kein Konflikt mehr: wer fertig ist, belegt nichts.
    if (item.laneId === NO_STATION || item.state === "done") continue;
    const list = lanesSeen.get(item.laneId) || [];
    for (const other of list) {
      if (item.start < other.end && other.start < item.end) {
        const station = laneName(item.laneId);
        other.conflicts.push({ type: "station_overlap", otherKey: item.key, text: `Überschneidet sich an ${station} mit ${item.key}.` });
        item.conflicts.push({ type: "station_overlap", otherKey: other.key, text: `Überschneidet sich an ${station} mit ${other.key}.` });
      }
    }
    list.push(item);
    lanesSeen.set(item.laneId, list);
  }

  const order = (a, b) => a.start - b.start || String(a.key).localeCompare(String(b.key), "de");
  items.sort(order);
  const laneIds = [...(stations || []).filter(Boolean).map((station) => station.id)];
  for (const item of items) if (item.laneId !== NO_STATION && !laneIds.includes(item.laneId)) laneIds.push(item.laneId);
  if (items.some((item) => item.laneId === NO_STATION)) laneIds.push(NO_STATION);
  const lanes = laneIds.map((id) => ({
    id,
    name: laneName(id),
    device: stationById.get(id)?.device_type || null,
    status: stationById.get(id)?.status || null,
    count: items.filter((item) => item.laneId === id).length,
  }));

  const first = items.length ? Math.min(...items.map((item) => item.start)) : floorTo(nowMs, 15);
  const last = items.length ? Math.max(...items.map((item) => item.end)) : first + 60 * MINUTE;
  const range = { start: floorTo(first, 15), end: Math.max(ceilTo(last, 15), floorTo(first, 15) + 60 * MINUTE) };
  return { items, lanes, unscheduled, range, now: nowMs };
}

/** Maßstab: Minuten mal `pxPerMinute`. */
export function timeScale(range, pxPerMinute) {
  const x = (ms) => ((ms - range.start) / MINUTE) * pxPerMinute;
  return {
    pxPerMinute,
    x,
    width: (item) => ((item.end - item.start) / MINUTE) * pxPerMinute,
    total: ((range.end - range.start) / MINUTE) * pxPerMinute,
    toTime: (px) => range.start + (px / pxPerMinute) * MINUTE,
  };
}

/** Striche auf der Achse, alle `step` Minuten. */
export function timeTicks(range, step = 15) {
  const ticks = [];
  for (let at = ceilTo(range.start, step); at <= range.end; at += step * MINUTE) ticks.push(at);
  return ticks;
}

/** Die Spiele einer Bahn, nach Zeit. */
export function laneSchedule(timeline, laneId) {
  return timeline.items.filter((item) => item.laneId === laneId);
}

/** Wer im Weg ist, wenn `itemId` an `laneId` um `start` stehen soll - für die Anzeige beim Ziehen. */
export function dropConflicts(timeline, itemId, laneId, start) {
  const moving = timeline.items.find((item) => item.id === itemId);
  if (!moving || laneId === NO_STATION) return [];
  const end = start + moving.minutes * MINUTE;
  return timeline.items.filter((item) => item.id !== itemId && item.laneId === laneId && item.state !== "done"
    && item.start < end && start < item.end);
}

/**
 * Verzug aus der Prognose des Planers: Wann das letzte Spiel jetzt beginnt, gegenüber dem gespeicherten Plan.
 * `null`, wenn es noch keinen gespeicherten Plan gibt oder die Vorschau nichts verschiebt.
 */
export function scheduleDelay(plan) {
  const rows = (plan?.assignments || []).filter((row) => row.scheduled_at && row.previous?.scheduled_at);
  if (!rows.length) return null;
  const last = rows.reduce((best, row) => (Date.parse(row.scheduled_at) > Date.parse(best.scheduled_at) ? row : best));
  const minutes = Math.round((Date.parse(last.scheduled_at) - Date.parse(last.previous.scheduled_at)) / MINUTE);
  if (!minutes) return null;
  return { minutes, label: last.label || last.match_key || "Spiel", at: Date.parse(last.scheduled_at), matchId: last.match_id };
}
