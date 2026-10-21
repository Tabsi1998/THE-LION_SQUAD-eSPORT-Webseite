// Turniertage im Ergebnisblatt (#1961): Runden R1…Rn je Zeile (Punkte wie gelesen, optional Platz in der Lobby samt
// Bots und die Lobby), GES P, Partner im Double Up und Sonderboni. Gerechnet und geprüft wird im Server
// (services/tournament_days.py) - hier stehen nur dieselben einfachen Regeln für Vorschlag und Anzeige: Tagessumme,
// Platz aus der Tagessumme (Wettbewerbsrang, ein Paar ist eine Einheit) und der Teil des Vertrags je Zeile.

import { cleanText, parseNumber, parsePlace } from "@/lib/resultPaste";

export const DAY_MARK_OPTIONS = [["dns", "DNS"], ["dsq", "DSQ"], ["left", "Ausgestiegen"]];
export const MAX_DAY_ROUNDS = 20;

const text = (value) => (value === null || value === undefined ? "" : String(value));

export function emptyRound(values = {}) {
  return { points: "", place: "", lobby: "", ...values };
}

/** Wie viele Spalten R1…Rn das Blatt zeigt: die Vorgabe der Saison oder mehr, wenn eine Zeile mehr Runden hat. */
export function roundCount(rules, rows = []) {
  const preset = Number(rules?.day_rounds?.count) || 0;
  const longest = Math.max(0, ...rows.map((row) => (row.rounds || []).length));
  return Math.min(MAX_DAY_ROUNDS, Math.max(preset, longest));
}

/** Arbeitet das Blatt mit Runden je Termin? Ja, wenn die Saison es vorgibt oder eine Zeile Runden oder GES P trägt. */
export function usesDayRounds(rules, rows = []) {
  return roundCount(rules, rows) > 0 || rows.some((row) => text(row.day_points).trim());
}

export function schemeOf(rules) {
  return rules?.day_rounds?.points_by_place || [];
}

/** Punkte einer Runde: wie eingetragen, sonst aus dem Platz in der Lobby und dem Rundenschema; `null` ohne beides. */
export function roundPoints(entry, scheme = []) {
  const points = parseNumber(entry?.points);
  if (points !== null) return points;
  const place = parsePlace(entry?.place);
  if (place === null) return null;
  return place <= scheme.length ? Number(scheme[place - 1]) : 0;
}

/** Summe der Runden einer Zeile - `null`, wenn keine Runde etwas trägt. */
export function roundsTotal(row, scheme = []) {
  const values = (row.rounds || []).map((entry) => roundPoints(entry, scheme)).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

/** Tagessumme (GES P): die des Veranstalters, sonst die Summe der Runden. */
export function dayTotal(row, scheme = []) {
  const given = parseNumber(row.day_points);
  return given !== null ? given : roundsTotal(row, scheme);
}

function filled(row) {
  return Boolean(row.participant_id || text(row.name).trim());
}

const nameKey = (value) => cleanText(value).toLowerCase();

/** Die Zeilen als Einheiten: ein Paar im Double Up (Partner über den Namen) ist eine, jede andere Zeile ihre eigene. */
export function dayUnits(rows, { doubleUp = false } = {}) {
  const byName = new Map(rows.map((row) => [nameKey(row.name), row]));
  const taken = new Set();
  const out = [];
  for (const row of rows) {
    if (taken.has(row.key)) continue;
    taken.add(row.key);
    const group = [row];
    const partner = doubleUp && text(row.partner).trim() ? byName.get(nameKey(row.partner)) : null;
    const mutual = partner && partner !== row && (!text(partner.partner).trim() || nameKey(partner.partner) === nameKey(row.name));
    if (mutual && !taken.has(partner.key)) {
      group.push(partner);
      taken.add(partner.key);
    }
    out.push(group);
  }
  return out;
}

/**
 * Platz aus der Tagessumme (`{[Zeilen-Schlüssel]: Platz | null}`) - nur, wenn mindestens eine Zeile eine Tagessumme hat,
 * sonst `null` (dann gilt die Reihenfolge). Wettbewerbsrang (4, 4, 6); ein Paar teilt seinen Platz; Nichtstart ohne Platz.
 */
export function dayPlaces(rows, { scheme = [], doubleUp = false } = {}) {
  const list = rows.filter(filled);
  if (!list.some((row) => dayTotal(row, scheme) !== null)) return null;
  const ranked = [];
  for (const group of dayUnits(list.filter((row) => !row.marks.includes("dns")), { doubleUp })) {
    const total = group.map((row) => dayTotal(row, scheme)).find((value) => value !== null);
    if (total !== undefined) ranked.push({ total, group });
  }
  ranked.sort((left, right) => right.total - left.total);
  const out = Object.fromEntries(list.map((row) => [row.key, null]));
  let previous = null;
  let place = 0;
  ranked.forEach(({ total, group }, index) => {
    if (total !== previous) {
      place = index + 1;
      previous = total;
    }
    for (const row of group) out[row.key] = place;
  });
  return out;
}

/** Feldfehler der Runden einer Zeile: Punkte als Zahl, Platz als ganze Zahl von 1 bis 100, GES P als Zahl. */
export function dayFieldErrors(row) {
  const out = {};
  (row.rounds || []).forEach((entry, index) => {
    if (text(entry.points).trim() && parseNumber(entry.points) === null) out[`round_${index}`] = `R${index + 1}: Punkte als Zahl.`;
    const place = parsePlace(entry.place);
    if (text(entry.place).trim() && (place === null || place > 100)) out[`round_place_${index}`] = `R${index + 1}: Platz als ganze Zahl von 1 bis 100.`;
  });
  if (text(row.day_points).trim() && parseNumber(row.day_points) === null) out.day_points = "GES P als Zahl.";
  return out;
}

/** Der Teil des Vertrags je Zeile (nur, was eingetragen ist). `reference(name)` findet den Partner in der Liste. */
export function dayRowPayload(row, { doubleUp = false, reference } = {}) {
  const out = {};
  const rounds = (row.rounds || []).map((entry) => {
    const points = parseNumber(entry.points);
    const place = parsePlace(entry.place);
    const lobby = cleanText(entry.lobby).slice(0, 20);
    if (points === null && place === null) return null;
    return { ...(points !== null ? { points } : {}), ...(place !== null ? { place } : {}), ...(lobby ? { lobby } : {}) };
  });
  while (rounds.length && rounds[rounds.length - 1] === null) rounds.pop();
  if (rounds.length) out.day_rounds = rounds;
  const given = parseNumber(row.day_points);
  if (given !== null) out.day_points = given;
  if (doubleUp && text(row.partner).trim() && reference) out.partner = reference(row.partner);
  if ((row.bonus_keys || []).length) out.bonus_keys = [...row.bonus_keys];
  return out;
}

/** Gespeicherte Runden ins Formular. */
export function roundsToForm(entries) {
  return (entries || []).map((entry) => emptyRound(entry ? { points: text(entry.points), place: text(entry.place), lobby: text(entry.lobby) } : {}));
}
