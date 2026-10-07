// Erfundene Hallen-Daten für die TV-Tests (Meilenstein 60, #1121-#1127): Aufrufe an Stationen, ein Event mit Tagen,
// Turnieren und vielen Stationen, eine Fast-Lap-Rangliste. Gebaut wie die Antworten des Servers (Stationen aus
// /api/stations, Event aus /api/events/<id>, Rangliste aus /api/f1/challenges/<id>/leaderboard). Alle Namen erfunden.
// Ein ES-Modul wie tvBrackets.mjs, damit Vitest und Playwright dieselben Daten nutzen.
import { NAMES, find, heats, singleElimination, start } from "./tvBrackets.mjs";

const MINUTE = 60 * 1000;

export const iso = (ms) => new Date(ms).toISOString();

export function stationId(name) {
  return `st-${String(name).replace(/\s+/g, "-").toLowerCase()}`;
}

/** Ein Aufruf: die Turnierleitung reserviert ein Spiel an einer Station („Zuweisen“), gestartet ist es noch nicht. */
export function call(bracket, key, { station = "PC 3", calledAt, scheduledAt = null } = {}) {
  const match = find(bracket, key);
  match.status = scheduledAt ? "scheduled" : "ready";
  match.station_id = stationId(station);
  match.station_name = station;
  match.station_label = station;
  match.called_at = calledAt;
  if (scheduledAt) match.scheduled_at = scheduledAt;
  return bracket;
}

/** Ein Spiel mit Station und Uhrzeit eingeplant, aber noch nicht aufgerufen. */
export function plan(bracket, key, { station = "PC 5", scheduledAt }) {
  const match = find(bracket, key);
  match.status = "scheduled";
  match.station_id = stationId(station);
  match.station_name = station;
  match.station_label = station;
  match.scheduled_at = scheduledAt;
  return bracket;
}

/**
 * Die Stationen zu einem oder mehreren Bäumen, wie /api/stations sie liefert: wo ein Spiel läuft „busy“, wo eines
 * aufgerufen ist „reserved“ mit `called_at`, dazu freie und defekte. `names` legt die Reihenfolge fest.
 */
export function stationsOf(brackets, { names = [], broken = [], tournamentId = "t1", eventId = null } = {}) {
  const used = new Map();
  for (const bracket of brackets) {
    for (const match of bracket.matches_v2) {
      if (!match.station_id) continue;
      const running = ["running", "in_progress", "live"].includes(match.status);
      if (!running && !match.called_at) continue;
      used.set(match.station_id, { match, running, tournamentId: bracket.tournament.id });
    }
  }
  return names.map((name) => {
    const id = stationId(name);
    const entry = used.get(id);
    const base = { id, name, device_type: name.startsWith("Switch") ? "switch" : name.startsWith("Sim") ? "racing_rig" : "pc", tournament_id: entry?.tournamentId || tournamentId, event_id: eventId, queue_match_ids: [] };
    if (broken.includes(name)) return { ...base, status: "broken", current_match_id: null };
    if (!entry) return { ...base, status: "free", current_match_id: null };
    return {
      ...base,
      status: entry.running ? "busy" : "reserved",
      current_match_id: entry.match.id,
      current_match_type: "matches_v2",
      ...(entry.running ? {} : { called_at: entry.match.called_at }),
    };
  });
}

function stationNames(count) {
  const names = [];
  for (let index = 1; names.length < count && index <= 12; index += 1) names.push(`PC ${index}`);
  for (let index = 1; names.length < count && index <= 8; index += 1) names.push(`Switch ${index}`);
  for (let index = 1; names.length < count; index += 1) names.push(`Sim ${index}`);
  return names;
}

/**
 * Ein Event in der Halle: ein Tag (10:00–22:00, Einlass 09:30) oder drei Tage (Fr 18–23, Sa 10–02 über Mitternacht,
 * So 10–16). Zwei Turniere mit Spielen an Stationen (laufend und aufgerufen), ein Turnier mit offener Anmeldung, eine
 * Fast Lap. `now` (ms) ist der Zeitpunkt, an dem der TV läuft - die Zeiten der Spiele hängen daran.
 */
export function hallEvent({ now, stations = 6, multiDay = false } = {}) {
  const ago = (minutes) => iso(now - minutes * MINUTE);
  const cup = singleElimination(16, { title: "Lions Herbst-Cup" });
  cup.tournament = { ...cup.tournament, id: "t1", slug: "herbst-cup", status: "live" };
  const kart = heats(16, { title: "Kart-Sprint" });
  kart.tournament = { ...kart.tournament, id: "t2", slug: "kart-sprint", status: "live" };
  kart.matches_v2.forEach((match) => { match.id = `k-${match.match_key}`; match.tournament_id = "t2"; });
  cup.matches_v2.forEach((match) => { match.tournament_id = "t1"; });
  kart.registrations = kart.registrations.map((reg) => ({ ...reg, id: `k${reg.id}` }));
  kart.matches_v2.forEach((match) => match.slots.forEach((slot) => { if (slot.registration_id) slot.registration_id = `k${slot.registration_id}`; }));

  const names = stationNames(stations);
  // Laufende und aufgerufene Spiele - so viele, wie es Stationen gibt (gut die Hälfte belegt, ein paar aufgerufen).
  const busyCount = Math.max(2, Math.round(stations * 0.45));
  const calledCount = Math.max(1, Math.round(stations * 0.2));
  const cupKeys = ["A", "B", "C", "D", "E", "F", "G", "H"];
  const kartKeys = ["A", "B", "C", "D"];
  const slots = [...cupKeys.map((key) => [cup, key]), ...kartKeys.map((key) => [kart, key])];
  let cursor = 0;
  for (let index = 0; index < busyCount && cursor < slots.length; index += 1, cursor += 1) {
    const [bracket, key] = slots[cursor];
    start(bracket, key, { station: names[cursor % names.length], startedAt: ago(4 + index * 3) });
  }
  for (let index = 0; index < calledCount && cursor < slots.length; index += 1, cursor += 1) {
    const [bracket, key] = slots[cursor];
    call(bracket, key, { station: names[cursor % names.length], calledAt: ago(1 + index) });
  }
  const broken = stations >= 6 ? [names[names.length - 1]] : [];
  const stationRows = stationsOf([cup, kart], { names, broken, eventId: "event-1" });

  const day = (date, start, end, door, offsetHours = 2) => {
    const at = (clock, nextDay = false) => {
      const [hour, minute] = clock.split(":").map(Number);
      const base = Date.parse(`${date}T00:00:00+0${offsetHours}:00`) + (nextDay ? 24 * 60 * MINUTE : 0);
      return iso(base + (hour * 60 + minute) * MINUTE);
    };
    const endsNextDay = end <= start;
    return { date, start, end, door, title: "", start_at: at(start), end_at: at(end, endsNextDay), door_at: door ? at(door) : null };
  };
  const today = new Date(now);
  const viennaDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Vienna", year: "numeric", month: "2-digit", day: "2-digit" }).format(today);
  const shiftDate = (dateText, days) => new Date(Date.parse(`${dateText}T12:00:00Z`) + days * 24 * 60 * MINUTE).toISOString().slice(0, 10);

  let days = [];
  let startDate;
  let endDate;
  let doorTime;
  if (multiDay) {
    days = [
      day(shiftDate(viennaDate, -1), "18:00", "23:00", "17:30"),
      day(viennaDate, "10:00", "02:00", "09:30"),
      day(shiftDate(viennaDate, 1), "10:00", "16:00", null),
    ];
    startDate = days[0].start_at;
    endDate = days[2].end_at;
    doorTime = days[0].door_at;
  } else {
    const single = day(viennaDate, "10:00", "22:00", "09:30");
    startDate = single.start_at;
    endDate = single.end_at;
    doorTime = single.door_at;
  }
  const todayAt = (clock) => {
    const [hour, minute] = clock.split(":").map(Number);
    return iso(Date.parse(`${viennaDate}T00:00:00+02:00`) + (hour * 60 + minute) * MINUTE);
  };
  cup.tournament = { ...cup.tournament, start_date: todayAt("12:00"), end_date: todayAt("16:00"), event_id: "event-1" };
  kart.tournament = { ...kart.tournament, start_date: todayAt("13:30"), end_date: todayAt("17:00"), event_id: "event-1" };
  const tournaments = [
    { ...cup.tournament, participant_count: 16 },
    { ...kart.tournament, participant_count: 16 },
    {
      id: "t3", slug: "abend-turnier", title: "Abend-Turnier", status: "registration_open", event_id: "event-1", start_date: todayAt("18:00"), end_date: todayAt("21:00"),
      check_in_from: todayAt("17:30"), check_in_until: todayAt("17:55"), registration_enabled: true, max_participants: 16, participant_count: 10,
    },
  ];
  const event = {
    id: "event-1", slug: "lions-lan", name: multiDay ? "Lions LAN Wochenende" : "Lions LAN Herbst", status: "live",
    start_date: startDate, end_date: endDate, door_time: doorTime, location: "Vereinsheim", city: "Musterstadt",
    days: multiDay ? days : [],
    tournaments,
    f1_challenges: [{ id: "f1-1", slug: "lions-fast-lap", title: "Lions Fast Lap", status: "live", start_date: todayAt("10:00"), end_date: todayAt("20:00"), track_count: 2 }],
  };
  return { event, stations: stationRows, brackets: { t1: cup, t2: kart } };
}

// ---------------------------------------------------------------- Fast Lap

export function lapText(ms) {
  const minutes = Math.floor(ms / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  const millis = ms % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

/** Eine Rangliste wie der Server: nach Zeit (mit Strafsekunden) sortiert, Platz, Abstand zur Spitze. */
export function rankBoard(board) {
  const entries = [...board.entries].sort((a, b) => a.time_ms - b.time_ms);
  entries.forEach((entry, index) => {
    entry.rank = index + 1;
    entry.time_str = lapText(entry.time_ms);
    entry.gap_ms = index ? entry.time_ms - entries[0].time_ms : 0;
    entry.gap_str = index ? `+${(entry.gap_ms / 1000).toFixed(3)}s` : "";
  });
  return { ...board, entries };
}

export function fastLapBoard(count = 10, { trackId = "track-1", trackName = "Spielberg" } = {}) {
  const entries = NAMES.slice(0, count).map((name, index) => ({
    user_id: `u${index + 1}`, display_name: name, avatar_url: null, time_ms: 80000 + index * 437 + (index % 3) * 51, raw_time_ms: 80000 + index * 437 + (index % 3) * 51,
    penalty_seconds: 0, attempts: 2 + (index % 4), last_updated: "2026-10-10T12:00:00+00:00", score_scope: "official",
  }));
  return rankBoard({ track: { id: trackId, name: trackName, country: "Österreich" }, entries, club_reference_entries: [] });
}

/** Eine neue Zeit: `ms` ist die gefahrene Zeit, `penalty` Strafsekunden obendrauf; ohne Eintrag eine neue Zeile. */
export function lap(board, userId, ms, { penalty = 0, name = null } = {}) {
  const next = JSON.parse(JSON.stringify(board));
  const effective = ms + Math.round(penalty * 1000);
  const existing = next.entries.find((entry) => entry.user_id === userId);
  if (existing) {
    existing.attempts += 1;
    if (effective < existing.time_ms) Object.assign(existing, { time_ms: effective, raw_time_ms: ms, penalty_seconds: penalty });
  } else {
    next.entries.push({ user_id: userId, display_name: name || userId, avatar_url: null, time_ms: effective, raw_time_ms: ms, penalty_seconds: penalty, attempts: 1, last_updated: "2026-10-10T12:30:00+00:00", score_scope: "official" });
  }
  return rankBoard(next);
}
