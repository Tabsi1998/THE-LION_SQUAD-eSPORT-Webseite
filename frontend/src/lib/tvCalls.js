// Aufruf-Tafel (#1122): Wer ist dran, an welcher Station, wie lange noch? Ein Spiel ist aufgerufen, wenn die
// Turnierleitung es einer Station zugewiesen, aber noch nicht gestartet hat (Station „reserviert“, am Spiel und an der
// Station steht „aufgerufen um“). Der Countdown läuft bis zur geplanten Zeit des Spiels; ohne geplante Zeit - oder wenn
// die schon vor dem Aufruf lag (Verspätung) - die „Zeit zum Antreten“ ab dem Aufruf. Bei 0 steht „Jetzt geht es los“.
// Startet das Spiel, ist der Aufruf weg. Dieselben Daten kann später die App nutzen („Du bist dran an PC 3“).
import { isMatchDone } from "@/lib/slotSource";
import { isLiveMatch, stationName } from "@/lib/tvLive";
import { asInstant } from "@/lib/vienna";

const MINUTE = 60000;
const OPEN = new Set(["pending", "preview", "ready", "scheduled"]);

function timeOf(value) {
  if (!value) return null;
  const time = asInstant(value).getTime();
  return Number.isNaN(time) ? null : time;
}

/** „PC 3“ - aus der Station, sonst aus dem Spiel; eine nackte Nummer wird „Station 3“. */
function nameOfStation(station, match) {
  const raw = String(station?.name || station?.label || "").trim();
  if (raw) return /^\d+$/.test(raw) ? `Station ${raw}` : raw;
  return stationName(match);
}

/**
 * Die Aufrufe, sortiert nach dem, der zuerst losgeht. Je Aufruf: das Spiel, die Station, „aufgerufen um“, bis wann
 * (`dueAt`, Millisekunden oder `null`) und wie lang der ganze Countdown ist (`totalMs`, für den Ring).
 */
export function callsOf(matches = [], stations = [], { reportMinutes = 2 } = {}) {
  const reservedFor = new Map();
  for (const station of stations || []) {
    if (station?.current_match_id && String(station.status || "") === "reserved") reservedFor.set(station.current_match_id, station);
  }
  const stationById = new Map((stations || []).map((station) => [station.id, station]));
  const report = Math.max(1, Number(reportMinutes) || 2) * MINUTE;
  const calls = [];
  for (const match of matches || []) {
    if (!match?.id || isMatchDone(match) || isLiveMatch(match)) continue;
    if (!OPEN.has(String(match.status || "pending"))) continue;
    const reserved = reservedFor.get(match.id);
    const calledAtText = match.called_at || reserved?.called_at || null;
    if (!calledAtText && !reserved) continue;
    if (!reserved && !match.station_id) continue;
    const station = reserved || stationById.get(match.station_id) || null;
    const calledAt = timeOf(calledAtText);
    const scheduled = timeOf(match.scheduled_at);
    let dueAt = null;
    if (scheduled !== null && (calledAt === null || scheduled > calledAt)) dueAt = scheduled;
    else if (calledAt !== null) dueAt = calledAt + report;
    const totalMs = dueAt === null ? null : Math.max(1000, dueAt - (calledAt ?? dueAt - report));
    calls.push({ match, matchId: match.id, stationId: station?.id || match.station_id || "", station: nameOfStation(station, match), calledAt, dueAt, totalMs });
  }
  return calls.sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER) || a.station.localeCompare(b.station, "de"));
}

/** „1:45“ bis zum Start - `done`, sobald die Zeit da ist; ohne Ziel kein Countdown. */
export function countdown(dueAt, now = Date.now()) {
  if (dueAt === null || dueAt === undefined) return { seconds: null, text: "", done: false };
  const seconds = Math.max(0, Math.ceil((dueAt - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return { seconds, text: `${minutes}:${String(seconds % 60).padStart(2, "0")}`, done: seconds === 0 };
}

/** Wie viel vom Ring noch übrig ist: 1 direkt nach dem Aufruf, 0 bei „Jetzt geht es los“. */
export function ringShare(call, now = Date.now()) {
  if (!call || call.dueAt === null || !call.totalMs) return 1;
  return Math.min(1, Math.max(0, (call.dueAt - now) / call.totalMs));
}

/**
 * Was danach kommt („Danach an PC 5 … ca. 14:25“): offene Spiele mit Station oder Uhrzeit, die weder laufen noch
 * aufgerufen sind - nach Uhrzeit, Spiele ohne Uhrzeit zuletzt.
 */
export function nextPlanned(matches = [], calls = [], { limit = 2 } = {}) {
  const called = new Set((calls || []).map((call) => call.matchId));
  return (matches || [])
    .filter((match) => match?.id && !called.has(match.id) && !isMatchDone(match) && !isLiveMatch(match))
    .filter((match) => match.station_id || match.scheduled_at)
    .map((match) => ({ match, at: timeOf(match.scheduled_at), station: stationName(match) }))
    .sort((a, b) => (a.at ?? Number.MAX_SAFE_INTEGER) - (b.at ?? Number.MAX_SAFE_INTEGER) || (a.match.round || 0) - (b.match.round || 0) || (a.match.order || 0) - (b.match.order || 0))
    .slice(0, limit);
}

/** Neue Aufrufe seit dem letzten Stand - für den Gong. Beim ersten Stand ist nichts neu. */
export function newCalls(previousIds, calls = []) {
  if (!previousIds) return [];
  return (calls || []).filter((call) => !previousIds.has(call.matchId)).map((call) => call.matchId);
}
