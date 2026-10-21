// Rennwochenende (#1930): Termine mit demselben Kürzel sind EINE Runde mit mehreren Läufen (Qualifying, Sprint,
// Rennen …). Der Server sagt je Termin seinen Lauf (`session`), dessen Art (`session_kind`) und die Runde (`weekend`);
// hier wird nur gruppiert, beschriftet und gezählt - für Kalender, Rennraster, Verwaltung, „Läuft gerade“ und „Heute im
// Einsatz“. Ein Termin ohne Lauf ist ein Rennen, bestehende Saisons sehen also aus wie bisher.
import { roundLabel } from "@/lib/referenceCalendar";
import { parsePointsList } from "@/lib/referenceSeries";

/** Auswahl beim Lauf eines Termins - freier Text bis 30 Zeichen geht auch. */
export const SESSION_CHOICES = ["Qualifying", "Sprint", "Rennen", "Hauptrennen", "Lauf 1", "Lauf 2"];
export const MAX_SESSION = 30;

/** Quelle des Startplatzes je Lauf (Vorgabe der Saison). */
export const GRID_OPTIONS = [
  ["manual", "Eingabe"],
  ["qualifying", "Aus dem Qualifying"],
  ["reverse_standings", "Umgekehrte WM-Reihenfolge"],
];

/** Punkte je Lauf: wie die Saison, keine oder ein eigenes Schema. */
export const SESSION_POINTS_OPTIONS = [["series", "Wie die Saison"], ["none", "Keine Punkte"], ["own", "Eigenes Schema"]];

function squash(value) {
  return String(value ?? "").split(/\s+/).join("").toLowerCase().replaceAll("-", "");
}

/** Art eines Laufs aus dem Namen - wie der Server: `qualifying`, `sprint` oder `race` (auch ohne Namen). */
export function sessionKind(label) {
  const key = squash(label);
  if (key.includes("quali") || key.includes("shootout") || key === "q" || key === "zeittraining") return "qualifying";
  if (key.includes("sprint") || key === "s") return "sprint";
  return "race";
}

/** Art des Laufs eines Termins - vom Server, sonst aus dem Namen. */
export function roundKind(round) {
  return round?.session_kind || sessionKind(round?.session);
}

/** Name des Laufs auf einem Chip: „Quali“, „Sprint“, „Rennen“, „Hauptrennen“ - ohne Lauf „Rennen“. */
export function chipLabel(round) {
  const label = String(round?.session || "").trim();
  if (!label) return "Rennen";
  return label.replace(/qualifying/i, "Quali");
}

const ABBREVIATIONS = { qualifying: "Q", quali: "Q", sprint: "S", rennen: "R", race: "R", hauptrennen: "HR", feature: "HR" };

/** Kurzform für schmale Spalten: Q, S, R, HR, L1 … - sonst die Anfangsbuchstaben (höchstens drei). */
export function sessionAbbr(round) {
  const label = String(round?.session || "").trim();
  if (!label) return "R";
  const key = label.toLowerCase();
  if (ABBREVIATIONS[key]) return ABBREVIATIONS[key];
  const heat = /^(lauf|heat)\s*(\d)$/i.exec(label);
  if (heat) return `L${heat[2]}`;
  if (roundKind(round) === "qualifying") return "Q";
  const words = label.split(/[\s-]+/).filter(Boolean);
  return (words.length > 1 ? words.map((word) => word[0]).join("") : label.slice(0, 3)).slice(0, 3).toUpperCase();
}

/** Kürzel mit Lauf: „R1 · Sprint“, ohne Lauf nur „R1“. */
export function sessionLabel(round) {
  const label = String(round?.session || "").trim();
  const code = roundLabel(round);
  return label ? `${code} · ${label}` : code;
}

function weekendKey(round) {
  if (round?.weekend) return `w${round.weekend}`;
  const code = String(round?.code || "").split(/\s+/).join("").toLowerCase();
  return code ? `c${code}` : `id${round?.id}`;
}

/** Hat die Saison Läufe? Erst dann zeigen Kalender und Raster Chips. */
export function hasSessions(rounds) {
  return (rounds || []).some((round) => String(round?.session || "").trim());
}

const STATE_ORDER = ["today", "missing", "postponed", "planned"];

/** Status einer Runde aus ihren Läufen: abgesagt nur, wenn alle es sind; gewertet, wenn alle übrigen gewertet sind;
 * sonst der dringendste offene (heute, Ergebnis fehlt, verschoben, geplant). */
export function weekendState(rounds) {
  const live = (rounds || []).filter((round) => round.state !== "cancelled");
  if (!live.length) return "cancelled";
  if (live.every((round) => round.state === "scored")) return "scored";
  return STATE_ORDER.find((state) => live.some((round) => round.state === state)) || "planned";
}

/** Die Runden in Kalender-Reihenfolge: je Runde Kürzel, Nummer, die Läufe und der Termin für Kopf und Ort (der erste
 * Lauf mit Ort bzw. der erste überhaupt). */
export function groupWeekends(rounds) {
  const groups = [];
  const byKey = new Map();
  for (const round of rounds || []) {
    const key = weekendKey(round);
    let group = byKey.get(key);
    if (!group) {
      group = { key, number: round.weekend || groups.length + 1, rounds: [] };
      byKey.set(key, group);
      groups.push(group);
    }
    group.rounds.push(round);
  }
  return groups.map((group) => {
    const lead = group.rounds[0];
    const place = group.rounds.find((round) => round.venue || round.title || round.country_code) || lead;
    return {
      ...group,
      lead,
      code: lead.code,
      position: lead.position,
      kind: group.rounds.some((round) => round.kind === "final") ? "final" : lead.kind,
      venue: place.venue,
      title: place.title,
      country_code: place.country_code,
      state: weekendState(group.rounds),
      multi: group.rounds.length > 1 || hasSessions(group.rounds),
    };
  });
}

/** Spalten des Rennrasters je Runde: `columns` sind die zählenden Läufe einer Runde (Reihenfolge des Kalenders). */
export function weekendColumns(columns) {
  return groupWeekends(columns).map((group) => ({ ...group, columns: group.rounds }));
}

/** Der nächste Lauf in Worten für „Läuft gerade“ und „Heute im Einsatz“: „R3 · Qualifying“. */
export function nextSessionLabel(next) {
  if (!next) return "";
  const code = next.code || next.title || "";
  return [code, next.session].filter(Boolean).join(" · ");
}

function points(list) {
  return list.map((value) => String(value).replace(".", ",")).join(" · ");
}

/** Punkte je Lauf in Worten für die Serienseite: „Sprint: 12 · 9 · 7 …“ - nur zählende Läufe mit eigenem Schema oder
 * ohne Punkte; ändert sich der Ablauf ab einer Runde, mit „ab Runde 5“. Leer ohne Vorgabe. */
export function sessionPointsLines(weekend) {
  const formats = weekend?.formats || [];
  const seen = new Set();
  const lines = [];
  for (const format of formats) {
    for (const session of format.sessions || []) {
      if (session.counts === false) continue;
      const text = Array.isArray(session.points) ? points(session.points) : session.points === "none" ? "keine Punkte" : "";
      const key = `${String(session.label).toLowerCase()}|${text}`;
      if (!text || seen.has(key)) continue;
      seen.add(key);
      const from = formats.length > 1 && format.from_round > 1 ? `ab Runde ${format.from_round} ` : "";
      lines.push(`${from}${session.label}: ${text}`);
    }
  }
  return lines;
}

// ---------------------------------------------------------------- Läufe je Runde (Verwaltung)

let formKey = 0;
const nextKey = (prefix) => {
  formKey += 1;
  return `${prefix}-${formKey}`;
};

/** Ein Lauf im Formular; Standard je Art wie im Server (Qualifying zählt nicht, Rennen startet aus dem Qualifying). */
export function emptySession(values = {}) {
  const kind = sessionKind(values.label);
  return {
    label: "", offset: "0", counts: kind !== "qualifying", points_mode: kind === "qualifying" ? "none" : "series",
    points: "", grid: kind === "race" ? "qualifying" : "manual", ...values, key: values.key || nextKey("lauf"),
  };
}

/** Ein Abschnitt „ab Runde X“ im Formular - neu mit Qualifying und Rennen (+30 Minuten). */
export function emptyFormat(values = {}) {
  return {
    from_round: "1",
    sessions: [emptySession({ label: "Qualifying", counts: false, points_mode: "none", grid: "manual" }), emptySession({ label: "Rennen", offset: "30" })],
    ...values,
    key: values.key || nextKey("format"),
  };
}

/** Läufe je Runde vom Server → Formular. */
export function weekendToForm(weekend) {
  return (weekend?.formats || []).map((format) => emptyFormat({
    from_round: String(format.from_round ?? 1),
    sessions: (format.sessions || []).map((session) => emptySession({
      label: session.label || "",
      offset: String(session.offset ?? 0),
      counts: session.counts !== false,
      points_mode: Array.isArray(session.points) ? "own" : session.points || "series",
      points: Array.isArray(session.points) ? session.points.join(", ") : "",
      grid: session.grid || "manual",
    })),
  }));
}

/** Formular → Läufe je Runde für den Server; ohne Abschnitt `null` (keine Vorgabe). */
export function weekendPayload(formats) {
  const list = (formats || []).filter((format) => (format.sessions || []).some((session) => String(session.label || "").trim()));
  if (!list.length) return null;
  return {
    formats: list.map((format) => ({
      from_round: Number(format.from_round) || 1,
      sessions: format.sessions.filter((session) => String(session.label || "").trim()).map((session) => ({
        label: String(session.label).trim(),
        offset: Number(String(session.offset || "0").replace(",", ".")) || 0,
        counts: Boolean(session.counts),
        // Wie „Punkte je Platz“ der Saison: „12, 9, 7“ oder „12-9-7“.
        points: session.points_mode === "own" ? parsePointsList(session.points) : session.points_mode,
        grid: session.grid,
      })),
    })),
  };
}

// ---------------------------------------------------------------- Fahrer-Detail

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

/** Ø Startplatz über die Rennen mit Startplatz (eingetragen oder aus dem Qualifying) - `null` ohne. */
export function averageGrid(results) {
  const grids = (results || []).map((item) => finite(item?.grid)).filter(Boolean);
  if (!grids.length) return null;
  return grids.reduce((sum, grid) => sum + grid, 0) / grids.length;
}

/** „Ø Start 4,5“ (eine Nachkommastelle, ganze ohne). */
export function averageGridLabel(value) {
  if (value === null || value === undefined) return "";
  const rounded = Math.round(value * 10) / 10;
  return `Ø Start ${String(rounded).replace(".", ",")}`;
}

/** Poles eines Fahrers: je Runde höchstens eine - aus der Pole am Rennen und Platz 1 im Qualifying (`qualifying` vom
 * Server: je Qualifying die Plätze). `rounds` ordnet Termine ihrer Runde zu. */
export function poleCount(row, rounds, qualifying) {
  const weekendOf = new Map((rounds || []).map((round) => [round.id, weekendKey(round)]));
  const seen = new Set();
  for (const item of row?.results || []) {
    if ((item.marks || []).includes("pole")) seen.add(weekendOf.get(item.round_id) || item.round_id);
  }
  for (const quali of qualifying || []) {
    if (quali?.places?.[row?.key] === 1) seen.add(weekendOf.get(quali.round_id) || quali.round_id);
  }
  return seen.size;
}

/** Quali-Duell zweier Fahrer: in wie vielen gemeinsamen Qualifyings wer vorn lag. */
export function qualiDuel(aKey, bKey, qualifying) {
  let a = 0;
  let b = 0;
  for (const quali of qualifying || []) {
    const mine = finite(quali?.places?.[aKey]);
    const theirs = finite(quali?.places?.[bKey]);
    if (!mine || !theirs) continue;
    if (mine < theirs) a += 1;
    else b += 1;
  }
  return { sessions: a + b, a, b };
}
