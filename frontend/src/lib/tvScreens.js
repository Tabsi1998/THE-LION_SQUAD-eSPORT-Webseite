// Pause-, Check-in- und Anmelde-Bildschirm (#1123): Der Turnierbaum-TV hat auch dann eine Aufgabe, wenn gerade nichts
// gespielt wird. Er wählt selbst: „Pausiert“ → Pause, Check-in läuft → Check-in, Anmeldung offen → Anmeldung, sonst die
// Wiedergabeliste (#1121). Gerechnet wird wie am Server: die Anmeldung ist offen, wenn sie es für Spieler wirklich ist
// (Status „Anmeldung offen“, eingeschaltet, im Zeitraum), der Check-in nach Status oder Zeitraum. Die Uhr läuft mit -
// der TV wechselt von selbst, auch ohne neue Daten.
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";
import { isMatchDone } from "@/lib/slotSource";
import { isLiveMatch, matchName, stationName } from "@/lib/tvLive";
import { asInstant, viennaDate, viennaDay, viennaTime } from "@/lib/vienna";

const TERMINAL = new Set(["completed", "results_published", "archived", "cancelled"]);

function timeOf(value) {
  if (!value) return null;
  const time = asInstant(value).getTime();
  return Number.isNaN(time) ? null : time;
}

function statusOf(tournament) {
  const status = String(tournament?.status || "").toLowerCase();
  return status === "checkin_open" ? "check_in" : status;
}

/** Kann man sich gerade anmelden? Dieselbe Regel wie beim Anmelden am Server. */
export function registrationOpen(tournament, now = Date.now()) {
  if (!tournament || tournament.registration_enabled === false || tournament.is_invite_only) return false;
  if (statusOf(tournament) !== "registration_open") return false;
  const from = timeOf(tournament.registration_open_from);
  const until = timeOf(tournament.registration_open_until);
  return (from === null || now >= from) && (until === null || now <= until);
}

/** Läuft der Check-in? Nach Status - oder im Check-in-Zeitraum, solange das Turnier noch nicht begonnen hat. */
export function checkInRunning(tournament, now = Date.now()) {
  const status = statusOf(tournament);
  if (status === "check_in") return true;
  if (!["scheduled", "registration_open", "registration_closed"].includes(status)) return false;
  const start = timeOf(tournament?.start_date);
  if (start !== null && now >= start) return false;
  const from = timeOf(tournament?.check_in_from);
  const until = timeOf(tournament?.check_in_until);
  return from !== null && now >= from && (until === null || now <= until);
}

/** Welcher Bildschirm: „pause“, „checkin“, „registration“ oder „playlist“ (Wiedergabeliste). */
export function tvScreenFor(tournament, { now = Date.now() } = {}) {
  if (!tournament) return "playlist";
  const status = statusOf(tournament);
  if (status === "paused") return "pause";
  if (TERMINAL.has(status) || status === "live") return "playlist";
  if (checkInRunning(tournament, now)) return "checkin";
  if (registrationOpen(tournament, now)) return "registration";
  return "playlist";
}

function clock(value) {
  return viennaTime(value, { hour: "2-digit", minute: "2-digit" });
}

/** „Winner Bracket, Runde 2 · Durchgang E an PC 3“ - was nach der Pause als Erstes dran ist. */
export function nextUp(matches = []) {
  const open = (matches || []).filter((match) => !isMatchDone(match) && !isLiveMatch(match) && (match.slots || []).some((slot) => slot.registration_id));
  if (!open.length) return null;
  const rank = (match) => (match.called_at ? 0 : match.station_id ? 1 : 2);
  const at = (match) => timeOf(match.called_at || match.scheduled_at) ?? Number.MAX_SAFE_INTEGER;
  const [first] = [...open].sort((a, b) => rank(a) - rank(b) || at(a) - at(b) || (a.round || 0) - (b.round || 0) || (a.order || 0) - (b.order || 0));
  const where = [formatBracketSection(first.section), formatRoundName(first.round_name, first.round)].filter(Boolean).join(", ");
  const station = stationName(first);
  const name = station ? `${matchName(first)} an ${station}` : matchName(first);
  return { match: first, text: [where, name].filter(Boolean).join(" · ") };
}

/**
 * Die Pause: „Kurze Pause · Weiter um 14:30“ mit Countdown; ohne Uhrzeit nur „Kurze Pause“; ist die Zeit vorbei,
 * „Gleich geht es weiter“ statt einer Minuszeit.
 */
export function pauseView(tournament, matches = [], now = Date.now()) {
  const until = timeOf(tournament?.paused_until);
  const next = nextUp(matches);
  if (until === null) return { state: "open", headline: "Kurze Pause", until: null, seconds: null, share: null, next };
  const seconds = Math.max(0, Math.ceil((until - now) / 1000));
  if (seconds === 0) return { state: "over", headline: "Gleich geht es weiter", until, seconds: 0, share: 0, next };
  return { state: "running", headline: `Weiter um ${clock(until)}`, until, seconds, next };
}

/** „12:41“ - Minuten und Sekunden, ab einer Stunde mit Stunden. */
export function pauseClock(seconds) {
  if (seconds === null || seconds === undefined) return "";
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = String(seconds % 60).padStart(2, "0");
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${rest}` : `${String(minutes).padStart(2, "0")}:${rest}`;
}

/** Der Check-in: wer da ist (Haken), wer noch fehlt, bis wann. Gezählt werden die bestätigten Anmeldungen. */
export function checkInView(tournament, registrations = []) {
  const people = (registrations || [])
    .filter((reg) => ["approved", "checked_in"].includes(String(reg?.status || "")))
    .map((reg) => ({ id: reg.id, name: reg.display_name || reg.user?.display_name || reg.ingame_name || "", present: reg.status === "checked_in" }))
    .filter((person) => person.name)
    .sort((a, b) => a.name.localeCompare(b.name, "de"));
  const present = people.filter((person) => person.present).length;
  const until = timeOf(tournament?.check_in_until);
  return {
    people,
    present,
    total: people.length,
    allPresent: people.length > 0 && present === people.length,
    closesAt: until,
    closesText: until === null ? "" : `Check-in schließt um ${clock(until)}.`,
  };
}

/** „Samstag, 18. Oktober · 14:00“ - am selben Tag „Heute · 14:00“. */
export function dayAndTime(value, now = Date.now()) {
  const time = timeOf(value);
  if (time === null) return "";
  if (viennaDay(time) === viennaDay(now)) return `Heute · ${clock(time)}`;
  return `${viennaDate(time, { weekday: "long", day: "numeric", month: "long" })} · ${clock(time)}`;
}

/** Die Anmeldung: freie Plätze („Noch 6 von 16 Plätzen frei“), Beginn, bis wann. */
export function registrationView(tournament, seats = null, registrations = [], now = Date.now()) {
  const capacity = Number(seats?.capacity ?? tournament?.max_participants) || null;
  const taken = Number.isFinite(Number(seats?.taken))
    ? Number(seats.taken)
    : (registrations || []).filter((reg) => ["pending", "approved", "checked_in"].includes(String(reg?.status || ""))).length;
  const free = capacity === null ? null : Math.max(0, capacity - taken);
  let seatsText = "";
  if (capacity !== null) seatsText = free > 0 ? `Noch ${free} von ${capacity} ${capacity === 1 ? "Platz" : "Plätzen"} frei` : `Alle ${capacity} Plätze vergeben – Warteliste offen`;
  const until = timeOf(tournament?.registration_open_until);
  return {
    capacity,
    taken: capacity === null ? taken : Math.min(taken, capacity),
    free,
    seatsText,
    startText: dayAndTime(tournament?.start_date, now),
    untilText: until === null ? "" : `Anmeldung bis ${dayAndTime(until, now).replace(/^Heute · /, "")}`,
  };
}
