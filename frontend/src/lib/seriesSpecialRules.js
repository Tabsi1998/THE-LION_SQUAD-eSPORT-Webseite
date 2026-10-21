// Sonderregeln einer Rennliga (#1960): was die Serienseite und die Verwaltung zu Anpassungen (±Punkte mit Grund),
// abgebrochener Saison, Termin ohne Wertung, Regeländerungen ab Runde X und der Teamwertung (Modus, Quelle) zeigen.
// Gerechnet wird im Server (services/series_adjustments.py, series_standings.py) - hier wird nur beschriftet und
// zwischen Formular und Server gewandelt.
import { dayLabel as staffDay } from "@/lib/referenceSeriesStaff";
import { formatNumber } from "@/lib/standingsTable";
import { sessionLabel } from "@/lib/raceWeekend";
import { parseNumber } from "@/lib/resultPaste";

// Ein echtes Minus (−5, wie die Tabellen es zeigen) zählt wie ein Bindestrich.
const signed = (value) => String(value ?? "").trim().replace("−", "-");

const number = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

/** Punkte einer Anpassung als Zeichen: „−5“, „+2,5“ (echtes Minus wie in den Tabellen). */
export function adjustmentText(points) {
  const value = number(points);
  if (!value) return "0";
  return `${value > 0 ? "+" : "−"}${formatNumber(Math.abs(value))}`;
}

/** Summe der Anpassungen einer Zeile (`adjustment_points` vom Server, sonst aus der Liste). */
export function adjustmentSum(row) {
  if (row?.adjustment_points !== undefined && row?.adjustment_points !== null) return number(row.adjustment_points);
  return (row?.adjustments || []).reduce((sum, item) => sum + number(item.points), 0);
}

/** Der Termin einer Anpassung als Kürzel mit Lauf („R4“, „R4 · Sprint“) - leer ohne oder unbekannt. */
function roundName(roundId, rounds) {
  const round = (rounds || []).find((item) => item.id === roundId);
  return round ? sessionLabel(round) : "";
}

/** Grund, Termin und Tag einer Anpassung: „Nichtteilnahme nach Anmeldung · R4 · 12.03.2026“. */
export function adjustmentDetail(item, rounds = []) {
  return [item?.reason, roundName(item?.round_id, rounds), staffDay(item?.day)].filter(Boolean).join(" · ");
}

/** Eine Anpassung in Worten: „−5 · Nichtteilnahme nach Anmeldung · R4 · 12.03.2026“. */
export function adjustmentLine(item, rounds = []) {
  return [adjustmentText(item?.points), adjustmentDetail(item, rounds)].filter(Boolean).join(" · ");
}

/** Tooltip und Screenreader der Marke an den Punkten: „Anpassung −5: Video fehlt; Anpassung +2: …“. */
export function adjustmentTitle(row, rounds = []) {
  return (row?.adjustments || []).map((item) => `Anpassung ${adjustmentLine(item, rounds)}`).join("; ");
}

// ---------------------------------------------------------------- Teamwertung
export const TEAM_MODE_OPTIONS = [
  ["per_race", "Je Rennen für das gefahrene Team"],
  ["current_lineup", "Aktuelle Besetzung: alle Saisonpunkte der Fahrer, die jetzt im Team sind"],
];
const TEAM_MODE_WORDS = Object.fromEntries(TEAM_MODE_OPTIONS);

/** Modus der Teamwertung in Worten (Vorgabe: je Rennen). */
export function teamModeLabel(scoring) {
  return TEAM_MODE_WORDS[scoring?.mode] || TEAM_MODE_WORDS.per_race;
}

/** Quelle der Teamwertung: „laut Veranstalter (nach R12)“ oder „berechnet“. */
export function teamSourceLabel(teams, rounds = []) {
  if (teams?.source !== "official") return "berechnet";
  const after = roundName(teams.round_id, rounds);
  return `laut Veranstalter${after ? ` (nach ${after})` : ""}`;
}

/** Ab welchem Rennen ein Fahrer im aktuellen Team ist (nur nach einem Wechsel, vom Server): „im Team seit R12“. */
export function teamSinceLabel(driver, rounds = []) {
  const name = roundName(driver?.team_since, rounds);
  return name ? `im Team seit ${name}` : "";
}

// ---------------------------------------------------------------- Termin ohne Wertung
export const NO_SCORE_OPTIONS = [
  ["", "— (zählt bzw. Vorgabe)"],
  ["too_few", "Zu wenig Fahrer"],
  ["outage", "Serverausfall bzw. Nachholung"],
  ["restart", "Neustart"],
  ["other", "Anderer Grund"],
];
export const NO_SCORE_LABELS = Object.fromEntries(NO_SCORE_OPTIONS.filter(([value]) => value));

/** „Ohne Wertung · Zu wenig Fahrer – Nur zwei am Start“ - leer, wenn der Termin keinen Grund trägt. */
export function noScoreText(round) {
  const reason = NO_SCORE_LABELS[round?.no_score_reason];
  if (!reason) return "";
  const note = String(round?.no_score_note || "").trim();
  return `Ohne Wertung · ${reason}${note ? ` – ${note}` : ""}`;
}

// ---------------------------------------------------------------- Saison abgebrochen
/** „Saison abgebrochen am 20.11.2026 – Neustart mit anderem Auto“ - leer, wenn sie nicht abgebrochen ist. */
export function cancelledText(series) {
  if (series?.status !== "cancelled") return "";
  const day = staffDay(series.cancelled_on);
  const reason = String(series.cancel_reason || "").trim();
  return `Saison abgebrochen${day ? ` am ${day}` : ""}${reason ? ` – ${reason}` : ""}`;
}

/** Adresse und Name des Nachfolgers: „2026 · F1 Neustart“. */
export function successorLink(successor) {
  if (!successor?.lineage_slug || !successor?.season_slug) return null;
  return {
    href: `/references/series/${successor.lineage_slug}/${successor.season_slug}`,
    label: successor.title || [successor.season, successor.tier].filter(Boolean).join(" · ") || "Neue Saison",
  };
}

// ---------------------------------------------------------------- Regeländerungen
/** Die Regeländerungen der Saison als Zeilen: „Ab R5 · 12.11.2026“ mit dem Hinweis (ohne Hinweis die Läufe des
 * neuen Formats) bzw. „Regeländerung · 04.03.2026“ mit dem Hinweis der neuen Version. */
export function ruleChangeLines(changes) {
  return (changes || []).map((item, index) => {
    const day = staffDay(item.day);
    if (item.kind === "format") {
      const head = item.to_round ? `R${item.from_round}–R${item.to_round}` : `Ab R${item.from_round}`;
      const text = item.note || (item.sessions?.length ? `Ablauf: ${item.sessions.join(" + ")}` : "Neuer Ablauf je Runde");
      return { key: `format-${item.from_round}`, head: [head, day].filter(Boolean).join(" · "), text };
    }
    return { key: `rules-${item.version || index}`, head: ["Regeländerung", day].filter(Boolean).join(" · "), text: item.note || "" };
  }).filter((item) => item.text);
}

// ---------------------------------------------------------------- Anpassungen (Verwaltung)
let formKey = 0;

/** Eine Anpassung im Formular - neu für einen Teilnehmer, heute, ohne Termin. */
export function emptyAdjustment(values = {}) {
  formKey += 1;
  return { key: `anpassung-${formKey}`, kind: "participant", participant_id: "", team: "", points: "-5", reason: "", day: "", round_id: "", ...values };
}

/** Gespeicherte Anpassung → Formular. */
export function adjustmentToForm(item) {
  return emptyAdjustment({
    id: item.id, kind: item.kind || "participant", participant_id: item.participant_id || "", team: item.team || "",
    points: String(item.points ?? ""), reason: item.reason || "", day: item.day || "", round_id: item.round_id || "",
  });
}

/** Feldfehler des Formulars - leer, wenn es passt. */
export function adjustmentErrors(form) {
  const errors = {};
  const points = parseNumber(signed(form.points));
  if (points === null || points === 0 || Math.abs(points) > 1000) errors.points = "Punkte als Zahl zwischen −1000 und 1000, nicht 0 – etwa −5.";
  if (!String(form.reason || "").trim()) errors.reason = "Grund fehlt – er steht öffentlich bei den Punkten.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(form.day || ""))) errors.day = "Tag fehlt.";
  if (form.kind === "team" ? !String(form.team || "").trim() : !form.participant_id) errors.who = form.kind === "team" ? "Team fehlt." : "Teilnehmer fehlt.";
  return errors;
}

/** Formular → Server. */
export function adjustmentPayload(form) {
  const team = form.kind === "team";
  return {
    kind: team ? "team" : "participant",
    participant_id: team ? null : form.participant_id || null,
    team: team ? String(form.team || "").trim() : null,
    points: parseNumber(signed(form.points)),
    reason: String(form.reason || "").split(/\s+/).filter(Boolean).join(" "),
    day: form.day,
    round_id: form.round_id || null,
  };
}

/** Für wen eine Anpassung gilt: der Name des Teilnehmers bzw. das Team. */
export function adjustmentTarget(item, participants = []) {
  if (item?.kind === "team") return item.team || "Team";
  return (participants || []).find((person) => person.id === item?.participant_id)?.name || "Teilnehmer";
}

// ---------------------------------------------------------------- Teamwertung laut Veranstalter (Eingabe)
/**
 * Eingefügte Teamwertung des Veranstalters: je Zeile ein Team und seine Punkte - „Team A 123“, „1. Team A 123“,
 * „Team A;123“ oder eine Tabelle mit Tab bzw. „|“ (die letzte Zahl der Zeile sind die Punkte, eine Platzzahl vorn
 * fällt weg). Kopfzeilen ohne Zahl werden übersprungen. Liefert `{ rows: [{ team, points }], errors }`.
 */
export function parseTeamTotals(text) {
  const rows = [];
  const errors = [];
  String(text || "").split(/\r?\n/).forEach((raw, index) => {
    const line = raw.split("\t").join(" ").split("|").join(" ").split(";").join(" ").split(/\s+/).filter(Boolean);
    if (!line.length) return;
    const last = line[line.length - 1];
    const points = parseNumber(last);
    if (points === null) {
      if (index === 0) return; // Kopfzeile
      errors.push({ line: index + 1, text: raw.trim(), message: "Punkte am Ende der Zeile fehlen." });
      return;
    }
    let words = line.slice(0, -1);
    if (words.length > 1 && /^\d{1,3}\.?$/.test(words[0])) words = words.slice(1);
    const team = words.join(" ").trim();
    if (!team) {
      errors.push({ line: index + 1, text: raw.trim(), message: "Teamname fehlt." });
      return;
    }
    if (team.length > 120) {
      errors.push({ line: index + 1, text: raw.trim(), message: "Teamname höchstens 120 Zeichen." });
      return;
    }
    rows.push({ team, points });
  });
  return { rows, errors };
}

/** Teamwerte als Zeilen fürs Formular (in gespeicherter Reihenfolge, nach Punkten). */
export function teamTotalsRows(totals) {
  return Object.entries(totals || {}).map(([team, points]) => ({ team, points })).sort((a, b) => number(b.points) - number(a.points));
}

/** Zeilen → `official_team_totals` (ein Team mehrfach: der letzte Wert gilt). */
export function teamTotalsObject(rows) {
  const out = {};
  for (const row of rows || []) {
    const team = String(row.team || "").trim();
    if (team && Number.isFinite(Number(row.points))) out[team] = Number(row.points);
  }
  return out;
}

/** Abweichung je Team zur eigenen Rechnung als Prüfhinweis: „Probe Löwen: laut Veranstalter 30, berechnet 26 (+4)“. */
export function teamDeviationText(row) {
  const deviation = number(row?.deviation);
  if (row?.official_points === null || row?.official_points === undefined || !deviation) return "";
  return `${row.team}: laut Veranstalter ${formatNumber(row.official_points)}, berechnet ${formatNumber(row.computed_points)} (${adjustmentText(deviation)})`;
}

