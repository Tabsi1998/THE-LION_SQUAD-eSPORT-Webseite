// Ergebnisse externer Serien eintragen (#1744): zwischen dem Formular (dynamische Liste) und dem Vertrag des Servers
// wandeln. Gerechnet und geprüft wird im Server (Vorschau) – hier wird nur übersetzt. Text aus der Zwischenablage liest
// ausschließlich `lib/resultPaste.js`.

import { cleanText, parseNumber, parsePlace } from "@/lib/resultPaste";

export const MARK_OPTIONS = [
  ["dnf", "DNF"], ["dns", "DNS"], ["dsq", "DSQ"], ["fastest_lap", "Schnellste Runde"], ["pole", "Pole"],
];
export const MARK_LABELS = Object.fromEntries(MARK_OPTIONS);

let counter = 0;
function nextKey(prefix) {
  counter += 1;
  return `${prefix}-${counter}`;
}

const text = (value) => (value === null || value === undefined ? "" : String(value));

export function emptyRow(values = {}) {
  return {
    key: nextKey("row"), participant_id: "", name: "", team: "", place: "", points: "", override: false, marks: [],
    penalty_points: "", start_number: "", official_total: "", note: "", source: "", points_hint: null,
    // Rennergebnis (#1927): Startplatz, Rennzeit, Abstand - als Text wie eingegeben. Strafsekunden (#1950) nur zur Anzeige.
    grid: "", time: "", gap: "", penalty_seconds: "", ...values,
  };
}

export function emptyMap() {
  return { key: nextKey("map"), name: "", home_score: "", away_score: "" };
}

export function emptyMatch({ home = "", away = "" } = {}) {
  return { key: nextKey("match"), home, away, home_score: "", away_score: "", maps: [], lineup: [] };
}

function participantName(participants, id) {
  return (participants || []).find((person) => person.id === id)?.name || "";
}

/** Ein gespeichertes Blatt (oder der Entwurf daneben) zurück ins Formular. */
export function sheetToForm(content, participants = [], { kind, teamName, opponent } = {}) {
  const totals = content?.official_totals || {};
  const rows = (content?.rows || []).map((row) => emptyRow({
    participant_id: row.participant_id || "",
    name: participantName(participants, row.participant_id),
    team: text(row.team),
    place: text(row.place),
    // Ohne Platz gespeichert (etwa Ausfall ohne Wertung): bleibt ohne Platz, bis jemand einen einträgt.
    no_place: row.place === null || row.place === undefined,
    points: row.points_source === "scheme" ? "" : text(row.points),
    override: row.points_source === "manual",
    marks: [...(row.marks || [])],
    penalty_points: row.penalty_points ? text(row.penalty_points) : "",
    official_total: text(totals[row.participant_id]),
    note: text(row.note),
    source: row.points_source || "",
    start_number: text(row.start_number),
    grid: text(row.grid),
    time: text(row.time),
    gap: text(row.gap),
    penalty_seconds: row.penalty_seconds ? text(row.penalty_seconds) : "",
  }));
  const matches = (content?.matches || []).map((match) => ({
    ...emptyMatch({ home: match.home, away: match.away }),
    home_score: text(match.home_score), away_score: text(match.away_score),
    maps: (match.maps || []).map((item) => ({ ...emptyMap(), name: item.name, home_score: text(item.home_score), away_score: text(item.away_score) })),
    lineup: (match.lineup || []).map((id) => ({ participant_id: id, name: participantName(participants, id) })),
  }));
  if (kind === "team_league" && !matches.length) matches.push(emptyMatch({ home: teamName || "", away: opponent || "" }));
  return {
    rows: rows.length || kind === "team_league" ? rows : [emptyRow()],
    matches,
    table: (content?.official_table || []).map((row) => ({ ...row })),
    // Teamwerte laut Veranstalter haben (noch) kein eigenes Feld im Blatt – sie gehen unverändert wieder mit.
    teamTotals: { ...(content?.official_team_totals || {}) },
    note: text(content?.note),
    // Je Rennen (#1927): schnellste Runde mit Zeit und Fahrer des Tages - im Formular über den Namen der Zeile.
    fastestLap: {
      name: participantName(participants, content?.fastest_lap?.participant_id),
      time: text(content?.fastest_lap?.time),
    },
    driverOfTheDay: participantName(participants, content?.driver_of_the_day),
  };
}

/** Eingefügte Zeilen (aus `parseResultPaste`) als Formularzeilen – bekannte Namen gleich mit Kennung. */
export function pastedToRows(parsed, participants = []) {
  return parsed.map((row) => {
    const known = matchParticipant(row.name, participants);
    return emptyRow({
      participant_id: known?.id || "",
      name: row.name,
      team: row.team || "",
      place: text(row.place),
      points: text(row.points),
      marks: [...row.marks],
      start_number: row.start_number || "",
      points_hint: row.points_hint || null,
      grid: text(row.grid),
      time: row.time || "",
      gap: row.gap || "",
    });
  });
}

/** „Letzte Zahl = Punkte“: die Zahl am Ende des Namens wird zu Punkten (nur, wenn der Name noch auf sie endet). */
export function hintToPoints(row, participants = []) {
  const hint = row.points_hint;
  const suffix = hint ? ` ${hint.text}` : "";
  if (!hint || !row.name.endsWith(suffix)) return { points_hint: null };
  const name = row.name.slice(0, -suffix.length);
  const known = matchParticipant(name, participants);
  return { name, points: hint.text, points_hint: null, participant_id: known?.id || "", ...(known && !row.team && known.default_team ? { team: known.default_team } : {}) };
}

/** Genau ein Teilnehmer mit diesem Namen (ohne Groß/klein) – sonst entscheidet der Server. */
export function matchParticipant(name, participants = []) {
  const wanted = cleanText(name).toLowerCase();
  if (!wanted) return null;
  const found = participants.filter((person) => cleanText(person.name).toLowerCase() === wanted);
  return found.length === 1 ? found[0] : null;
}

// Zahlen aus den Feldern: leer heißt „keine Angabe“; alles andere muss eine gültige Zahl sein, sonst meldet
// `fieldErrors` einen Feldfehler und das Blatt lässt sich nicht prüfen oder speichern – nie still umdeuten.
function number(value) {
  return parseNumber(value);
}

const LIMITS = { points: 10000, penalty: 10000, total: 100000, score: 1_000_000_000, seconds: 3600 };

function checkNumber(value, { min, max, message }) {
  if (!text(value).trim()) return null;
  const parsed = parseNumber(value);
  return parsed === null || parsed < min || parsed > max ? message : null;
}

/**
 * Feldfehler des Formulars: `{[Zeilen-, Spiel- oder Map-Schlüssel]: {Feld: Meldung}}`. Ein ungültiger Platz („1,5“,
 * „0“), ungültige Punkte, Strafpunkte, Gesamtstände oder Spielstände halten Vorschau und Speichern auf.
 */
export function fieldErrors(form) {
  const out = {};
  const add = (key, field, message) => { if (message) (out[key] ||= {})[field] = message; };
  for (const row of form.rows) {
    if (text(row.place).trim() && parsePlace(row.place) === null) add(row.key, "place", "Platz als ganze Zahl von 1 bis 1000.");
    if (text(row.grid).trim() && parsePlace(row.grid) === null) add(row.key, "grid", "Startplatz als ganze Zahl von 1 bis 1000.");
    add(row.key, "points", checkNumber(row.points, { min: -LIMITS.points, max: LIMITS.points, message: "Punkte als Zahl, etwa 25 oder 12,5." }));
    add(row.key, "penalty_points", checkNumber(row.penalty_points, { min: 0, max: LIMITS.penalty, message: "Strafpunkte als Zahl ab 0." }));
    add(row.key, "penalty_seconds", checkNumber(row.penalty_seconds, { min: 0, max: LIMITS.seconds, message: "Strafsekunden als Zahl von 0 bis 3600." }));
    add(row.key, "official_total", checkNumber(row.official_total, { min: -LIMITS.total, max: LIMITS.total, message: "Gesamtstand als Zahl." }));
  }
  // Schnellste Runde (#1927): eine Zeit braucht ihren Fahrer - den Namen oder genau eine markierte Zeile.
  const lapTime = cleanText(form.fastestLap?.time);
  const lapDriver = cleanText(form.fastestLap?.name);
  const markedRows = form.rows.filter((row) => filled(row) && row.marks.includes("fastest_lap")).length;
  if (lapTime && !lapDriver && markedRows !== 1) {
    add("race", "fastest_lap", "Zur Rundenzeit fehlt der Fahrer – Namen eintragen oder genau eine Zeile als „Schnellste Runde“ markieren.");
  }
  for (const match of form.matches) {
    const used = text(match.home).trim() || text(match.away).trim();
    for (const side of ["home_score", "away_score"]) {
      if (used && !text(match[side]).trim()) add(match.key, side, "Ergebnis fehlt.");
      else add(match.key, side, checkNumber(match[side], { min: 0, max: LIMITS.score, message: "Ergebnis als Zahl ab 0." }));
    }
    for (const item of match.maps) {
      const named = text(item.name).trim();
      const scored = text(item.home_score).trim() || text(item.away_score).trim();
      if (!named && scored) add(item.key, "name", "Name der Map fehlt.");
      for (const side of ["home_score", "away_score"]) {
        if (named && !text(item[side]).trim()) add(item.key, side, "Stand fehlt.");
        else add(item.key, side, checkNumber(item[side], { min: 0, max: LIMITS.score, message: "Stand als Zahl ab 0." }));
      }
    }
  }
  return out;
}

export function countFieldErrors(errors) {
  return Object.values(errors).reduce((sum, fields) => sum + Object.keys(fields).length, 0);
}

function reference(item) {
  if (item.participant_id) return { participant_id: item.participant_id };
  const out = { name: cleanText(item.name) };
  if (text(item.start_number).trim()) out.start_number = text(item.start_number).trim();
  return out;
}

function filled(row) {
  return Boolean(row.participant_id || text(row.name).trim());
}

/** Angaben aus dem Rennergebnis (#1927) - nur, was eingetragen ist; Startplatz als Zahl. */
function raceDetails(row) {
  const out = {};
  const startNumber = text(row.start_number).trim();
  if (startNumber) out.start_number = startNumber.slice(0, 10);
  const grid = parsePlace(row.grid);
  if (grid !== null) out.grid = grid;
  for (const key of ["time", "gap"]) {
    const value = cleanText(row[key]);
    if (value) out[key] = value.slice(0, 20);
  }
  const seconds = parseNumber(row.penalty_seconds);
  if (seconds !== null && seconds > 0) out.penalty_seconds = seconds;
  return out;
}

/** Wer in der Liste gemeint ist (schnellste Runde, Fahrer des Tages): die Kennung der Zeile mit diesem Namen, sonst
 * der Name - der Server ordnet ihn zu und meldet, wenn er nicht in der Liste steht. */
function rowReference(name, rows) {
  const wanted = cleanText(name);
  if (!wanted) return null;
  const row = rows.find((item) => filled(item) && cleanText(item.name).toLowerCase() === wanted.toLowerCase());
  if (row?.participant_id) return { participant_id: row.participant_id };
  return { name: row ? cleanText(row.name) : wanted };
}

/** Platz aus der Reihenfolge je Zeile (für leere Platzfelder): gezählt werden nur ausgefüllte Zeilen. */
export function autoPlaces(rows) {
  const out = {};
  let seen = 0;
  for (const row of rows) {
    if (!filled(row)) continue;
    seen += 1;
    out[row.key] = row.marks.includes("dns") || row.no_place ? null : seen;
  }
  return out;
}

/**
 * Das Formular als Body für Vorschau und Übernehmen. Leere Zeilen fallen weg; ohne eingetragenen Platz zählt die
 * Reihenfolge (Nichtstart ohne Platz). Punkte: leer = nach Schlüssel; eingetragen = laut Veranstalter (geprüft gegen den
 * Schlüssel) oder – mit „überschreiben“ – als Wert, der zählt. `rowKeys[i]` ist die Formularzeile zu Zeile `i` im Body.
 */
export function formToPayload(form) {
  const rowKeys = [];
  const rows = [];
  const auto = autoPlaces(form.rows);
  form.rows.forEach((row) => {
    if (!filled(row)) return;
    const points = number(row.points);
    const explicitPlace = parsePlace(row.place);
    const out = {
      ...reference(row),
      ...raceDetails(row),
      place: explicitPlace !== null ? Math.trunc(explicitPlace) : auto[row.key],
      team: text(row.team).trim() || null,
      points,
      // Ohne Punkte bleibt die gespeicherte Herkunft (etwa „laut Veranstalter“ ohne Wert) erhalten.
      points_source: points === null ? (row.source === "organizer" ? "organizer" : "scheme") : (row.override ? "manual" : "organizer"),
      marks: [...row.marks],
      penalty_points: number(row.penalty_points) || 0,
      official_total: number(row.official_total),
      note: text(row.note).trim() || null,
    };
    rowKeys.push(row.key);
    rows.push(out);
  });
  const matches = form.matches
    .filter((match) => text(match.home).trim() || text(match.away).trim())
    .map((match) => ({
      home: text(match.home).trim(), away: text(match.away).trim(),
      home_score: number(match.home_score) || 0, away_score: number(match.away_score) || 0,
      maps: match.maps.filter((item) => text(item.name).trim()).map((item) => ({
        name: text(item.name).trim(), home_score: number(item.home_score) || 0, away_score: number(item.away_score) || 0,
      })),
      lineup: match.lineup.filter(filled).map(reference),
    }));
  const official_table = form.table.map((row) => {
    const out = { team: row.team };
    for (const key of ["rank", "played", "won", "drawn", "lost", "score_for", "score_against", "score_diff", "points"]) {
      if (row[key] !== null && row[key] !== undefined) out[key] = row[key];
    }
    return out;
  });
  const note = text(form.note).trim();
  const payload = { rows, matches, official_team_totals: { ...(form.teamTotals || {}) }, official_table, note: note || null };
  const fastest = rowReference(form.fastestLap?.name, form.rows);
  const lapTime = cleanText(form.fastestLap?.time).slice(0, 20);
  if (fastest || lapTime) payload.fastest_lap = { ...(fastest || {}), time: lapTime || null };
  const driver = rowReference(form.driverOfTheDay, form.rows);
  if (driver) payload.driver_of_the_day = driver;
  return { payload, rowKeys };
}

/** Fehler und Warnungen der Vorschau je Formularzeile (`{key: [{level, message}]}`) und die ohne Zeile. */
export function problemsByRow(preview, rowKeys = []) {
  const byRow = {};
  const general = [];
  // Meldungen zu einem Feld des Rennens (#1927: schnellste Runde, Fahrer des Tages) stehen an diesem Feld.
  const byField = {};
  const add = (problem, level) => {
    if (problem.field) {
      (byField[problem.field] ||= []).push({ level, message: problem.message });
      return;
    }
    const indexes = problem.match === undefined || problem.match === null ? problem.rows || [] : [];
    const keys = indexes.map((index) => rowKeys[index]).filter(Boolean);
    if (!keys.length) {
      general.push({ level, message: problem.message, match: problem.match });
      return;
    }
    for (const key of keys) (byRow[key] ||= []).push({ level, message: problem.message });
  };
  (preview?.errors || []).forEach((problem) => add(problem, "error"));
  (preview?.warnings || []).forEach((problem) => add(problem, "warning"));
  return { byRow, general, byField };
}

/** Rechnung einer Zeile kurz: „25 Pkt (24 + 1 Bonus)“. */
export function scoredText(scored) {
  if (!scored) return "";
  const parts = [];
  if (scored.bonus) parts.push(`+ ${formatPoints(scored.bonus)} Bonus`);
  if (scored.penalty) parts.push(`− ${formatPoints(scored.penalty)} Strafe`);
  const detail = parts.length ? ` (${formatPoints(scored.base)} ${parts.join(" ")})` : "";
  return `${formatPoints(scored.points)} Pkt${detail}`;
}

export function formatPoints(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return "–";
  return String(Number.isInteger(parsed) ? parsed : Math.round(parsed * 10) / 10).replace(".", ",");
}

/** Stand des Formulars als Text – die Vorschau gilt nur, solange er sich nicht ändert. */
export function formStamp(payload) {
  return JSON.stringify(payload);
}
