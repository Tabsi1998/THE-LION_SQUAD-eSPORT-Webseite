// Reiter „Spiele und Ergebnisse“ der Staffel-Seite (#2262, Paket B): die Spiele je Spielwoche mit Stand, Ergebnis und Chips. Die
// Chips kommen aus `league_marks` (Server, `services/league_match_marks.py`) - dieselbe Rechnung wie Matchseite und Leitstand, hier nur
// angezeigt. Bedient wird auf der Matchseite.
import { countsAsMatch } from "@/lib/bracketGraph";

/** Die Spielwoche eines Spiels - wie `matchday_schedule.matchday_number_of` im Server. `null` ohne Woche. */
export function matchdayOf(match) {
  for (const key of ["matchday_number", "round", "round_index"]) {
    const value = Number(match?.[key]);
    if (Number.isInteger(value) && value >= 1) return value;
  }
  return null;
}

/** Echte Spiele (ohne Vorschau und Abgesagtes) je Woche: `[{number, matches}]`, aufsteigend, Spiele ohne Woche am Ende. */
export function gamesByWeek(matches = []) {
  const weeks = new Map();
  for (const match of (matches || []).filter(countsAsMatch)) {
    const number = matchdayOf(match);
    weeks.set(number, [...(weeks.get(number) || []), match]);
  }
  return [...weeks.entries()]
    .sort(([a], [b]) => (a == null) - (b == null) || (a || 0) - (b || 0))
    .map(([number, list]) => ({ number, matches: list }));
}

const RUNNING = new Set(["in_progress", "running", "waiting_result"]);

/** Der Stand eines Spiels in Liga-Wörtern, mit Ton für die Farbe (`done`, `live`, `warn`, `open`). */
export function gameState(match) {
  const status = String(match?.status || "pending");
  if (status === "forfeit") return { tone: "done", text: match.double_forfeit ? "Beide nicht erschienen" : "Kampflos gewertet" };
  if (status === "completed" || status === "archived") return { tone: "done", text: "Gespielt" };
  if (status === "disputed") return { tone: "warn", text: "In Klärung" };
  if (match?.reports?.length || match?.pending_result) return { tone: "live", text: "Meldung liegt vor" };
  if (RUNNING.has(status) || match?.started_at) return { tone: "live", text: "Läuft" };
  return match?.scheduled_at ? { tone: "open", text: "Geplant" } : { tone: "open", text: "Termin offen" };
}

/** Das Ergebnis in Platzreihenfolge („2 : 1“) und wer gewonnen hat - leer, solange nichts steht. */
export function gameScore(match) {
  const results = Array.isArray(match?.results) ? match.results : [];
  const sides = (match?.slots || []).map((slot) => slot?.registration_id).filter(Boolean);
  const scores = sides.map((id) => results.find((row) => row?.registration_id === id)?.score);
  if (sides.length !== 2 || scores.some((value) => value == null || value === "")) return { text: "", winner: null };
  const winner = results.find((row) => Number(row?.rank) === 1 && sides.includes(row.registration_id))?.registration_id || null;
  return { text: `${scores[0]} : ${scores[1]}`, winner };
}

const CHECKIN = {
  open: (count) => ({ text: `Check-in ${count} von 2`, tone: "info" }),
  closed: (count) => ({ text: `Check-in vorbei · ${count} von 2`, tone: "warn" }),
  ready: () => ({ text: "Beide eingecheckt", tone: "ok" }),
  veto: () => ({ text: "Beide eingecheckt", tone: "ok" }),
};
const VETO = { running: { text: "Veto läuft", tone: "info" }, paused: { text: "Veto pausiert", tone: "warn" } };
const plural = (count, one, many) => (count === 1 ? one : `${count} ${many}`);

/** Chips eines Spiels: Check-in, Veto, Vorfall, Verfahren - nur was gerade zählt. `[{key, text, tone}]`. */
export function gameChips(match) {
  const marks = match?.league_marks;
  if (!marks) return [];
  const chips = [];
  const checkin = CHECKIN[marks.checkin];
  if (checkin) chips.push({ key: "checkin", ...checkin(Number(marks.checked_in) || 0) });
  const veto = VETO[marks.veto] || (marks.checkin === "veto" ? { text: "Veto steht an", tone: "info" } : null);
  if (veto) chips.push({ key: "veto", ...veto });
  const incidents = Number(marks.incidents) || 0;
  if (incidents) chips.push({ key: "incidents", text: plural(incidents, "Vorfall offen", "Vorfälle offen"), tone: "warn" });
  const procedures = Number(marks.procedures) || 0;
  if (procedures) chips.push({ key: "procedures", text: plural(procedures, "Verfahren offen", "Verfahren offen"), tone: "warn" });
  return chips;
}

// Was im Kopf einer Woche steht, wenn etwas jemanden braucht - dieselben warnenden Chips, zusammengezählt.
const WARN_KINDS = [
  { key: "procedures", count: (marks) => Number(marks.procedures) || 0, one: "Verfahren offen", many: "Verfahren offen" },
  { key: "incidents", count: (marks) => Number(marks.incidents) || 0, one: "Vorfall offen", many: "Vorfälle offen" },
  { key: "checkin", count: (marks) => (marks.checkin === "closed" ? 1 : 0), one: "Check-in vorbei", many: "Check-ins vorbei" },
  { key: "veto", count: (marks) => (marks.veto === "paused" ? 1 : 0), one: "Veto pausiert", many: "Vetos pausiert" },
];

/** „1 Verfahren offen“, „2 Vorfälle offen“ - bei verschiedenen Arten „3 offene Punkte“, ohne Warnung leer. */
export function weekWarnText(matches = []) {
  const totals = WARN_KINDS.map((kind) => ({ ...kind, total: (matches || []).reduce((sum, match) => sum + (match?.league_marks ? kind.count(match.league_marks) : 0), 0) }))
    .filter((kind) => kind.total > 0);
  if (!totals.length) return "";
  if (totals.length === 1) return `${totals[0].total} ${totals[0].total === 1 ? totals[0].one : totals[0].many}`;
  return `${totals.reduce((sum, kind) => sum + kind.total, 0)} offene Punkte`;
}
