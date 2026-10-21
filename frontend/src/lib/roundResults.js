// Ergebnistabelle je Runde und Lauf (#1950): was die Seite /references/series/<spur>/<saison>/runde/<nr> aus
// /api/reference-series/public/<spur>/<saison>/rounds/<nr> macht. Gerechnet wird im Server - hier wird nur gewählt
// (Reiter, Spalten), beschriftet (Platz, Abzeichen, Start → Ziel) und die Zusammenfassung gebaut. Fremde Namen stehen nur
// in der Tabelle: außerhalb (Zusammenfassung) mit Namen nur öffentliche Vereinsfahrer (`club_drivers` vom Server), wie
// beim Rennkalender der Serienseite - sonst das Team.
import { formatNumber } from "@/lib/standingsTable";
import { formatRaceTime } from "@/lib/raceTime";
import { countryName } from "@/lib/countryFlags";
import { dayLabel } from "@/lib/referenceCalendar";
import { nameOf } from "@/lib/referenceSeriesTable";

export const SESSION_PARAM = "lauf";
const UMLAUTS = { ä: "ae", ö: "oe", ü: "ue", ß: "ss" };

/** Schlüssel eines Laufs für die Adresse - wie im Server: „Qualifying“ → `qualifying`, „Lauf 1“ → `lauf-1`. */
export function sessionKey(label) {
  const text = String(label ?? "").split(/\s+/).filter(Boolean).join(" ").toLowerCase() || "rennen";
  let out = "";
  let dash = false;
  for (const raw of text) {
    const char = UMLAUTS[raw] || raw;
    if (/^[a-z0-9]+$/.test(char)) {
      out += char;
      dash = false;
    } else if (out && !dash) {
      out += "-";
      dash = true;
    }
  }
  return out.replace(/-+$/, "") || "rennen";
}

/** Adresse einer Runde, optional mit Lauf (`?lauf=sprint`); ohne Lauf zeigt die Seite das Hauptrennen. */
export function roundPath(lineageSlug, seasonSlug, number, session = "") {
  if (!lineageSlug || !seasonSlug || !number) return "";
  const base = `/references/series/${encodeURIComponent(lineageSlug)}/${encodeURIComponent(seasonSlug)}/runde/${number}`;
  return session ? `${base}?${SESSION_PARAM}=${encodeURIComponent(session)}` : base;
}

/** Der gezeigte Lauf: der aus der Adresse, sonst das Hauptrennen, sonst der erste. */
export function pickSession(page, wanted) {
  const sessions = page?.sessions || [];
  return sessions.find((item) => item.key === wanted) || sessions.find((item) => item.key === page?.main) || sessions[0] || null;
}

const STATUS_SHORT = { dnf: "DNF", dns: "DNS", dsq: "DSQ" };
const STATUS_WORD = { dnf: "Ausfall", dns: "Nicht gestartet", dsq: "Disqualifiziert" };

/** Platz in der ersten Spalte: die Zahl, sonst DNF, DNS oder DSQ. */
export function posLabel(row) {
  if (row?.status && row.status !== "finished") return STATUS_SHORT[row.status] || "–";
  return row?.place ? String(row.place) : "–";
}

/** Gold, Silber, Bronze für Platz 1 bis 3 im Ziel. */
export function medalOf(row) {
  if (row?.status !== "finished") return null;
  return { 1: "gold", 2: "silver", 3: "bronze" }[row.place] || null;
}

/** Strafsekunden als Text: „+5 s“, „+2,5 s“. */
export function penaltyLabel(seconds) {
  const value = Number(seconds);
  return Number.isFinite(value) && value > 0 ? `+${formatNumber(value)} s` : "";
}

/** Abzeichen einer Zeile - `penalty: false` lässt die Strafe weg (am PC steht sie in einer eigenen Spalte). */
export function rowBadges(row, { penalty = true } = {}) {
  const marks = new Set(row?.marks || []);
  const out = [];
  if (marks.has("pole")) out.push({ key: "pole", label: "Pole", short: "Pole" });
  if (row?.fastest_lap) out.push({ key: "fastest_lap", label: "Schnellste Runde", short: "Beste Runde" });
  if (row?.driver_of_the_day) out.push({ key: "driver_of_the_day", label: "Fahrer des Tages", short: "Fahrer des Tages" });
  if (row?.status === "dnf") out.push({ key: "dnf", label: "Ausfall", short: "DNF" });
  if (row?.status === "dsq") out.push({ key: "dsq", label: "Disqualifiziert", short: "DSQ" });
  if (penalty && penaltyLabel(row?.penalty_seconds)) {
    const text = penaltyLabel(row.penalty_seconds);
    out.push({ key: "penalty", label: `${text} Strafe`, short: `${text} Strafe` });
  }
  return out;
}

/** Start → Ziel: gewonnene bzw. verlorene Plätze, `null` ohne Startplatz, ohne Ziel oder bei gleichem Platz. */
export function movement(row) {
  const gained = Number(row?.gained);
  if (row?.gained === null || row?.gained === undefined || !Number.isFinite(gained) || gained === 0) return null;
  return { dir: gained > 0 ? "up" : "down", by: Math.abs(gained) };
}

export function movementLabel(move) {
  if (!move) return "";
  const places = `${move.by} ${move.by === 1 ? "Platz" : "Plätze"}`;
  return move.dir === "up" ? `${places} gutgemacht` : `${places} verloren`;
}

/** Zeit-Spalte: die Zeit; steht nur ein Abstand da (wie beim Veranstalter ab Platz 2), bleibt sie leer, sonst ein
 * Strich. Abstand-Spalte: der Abstand, sonst bei Ausfall das Wort. */
export function timeText(row) {
  const time = formatRaceTime(row?.time);
  if (time) return time;
  return formatRaceTime(row?.gap) ? "" : "–";
}

export function gapText(row) {
  const gap = formatRaceTime(row?.gap);
  if (gap) return gap;
  return row?.status && row.status !== "finished" ? STATUS_WORD[row.status] || "" : "";
}

/** Handy: rechts groß die gefahrene Zeit (sonst Abstand bzw. Ausfall), darunter klein Abstand und Punkte. Zeiten wie
 * beim Veranstalter mit Komma (#1981). */
export function mobileMain(row) {
  return formatRaceTime(row?.time) || formatRaceTime(row?.gap) || (row?.status !== "finished" ? STATUS_WORD[row?.status] : "") || "–";
}

export function mobileSub(row, { points = false } = {}) {
  const parts = [];
  if (formatRaceTime(row?.time) && formatRaceTime(row?.gap)) parts.push(formatRaceTime(row.gap));
  if (points && row?.points !== null && row?.points !== undefined) parts.push(`${formatNumber(row.points)} P`);
  return parts.join(" · ");
}

/** Spalten eines Laufs - nur, was etwas zeigt: ohne Zeiten bleiben Pos, Name, Team und Punkte. */
export function visibleColumns(session) {
  const has = new Set(session?.columns || []);
  const rows = session?.rows || [];
  const out = ["pos"];
  if (has.has("start_number")) out.push("number");
  out.push("name");
  if (rows.some((row) => row.team)) out.push("team");
  if (has.has("grid") && session?.kind !== "qualifying") out.push("grid");
  if (has.has("time")) out.push("time");
  if (has.has("gap")) out.push("gap");
  if (has.has("penalty_seconds")) out.push("penalty");
  if (has.has("points")) out.push("points");
  return out;
}

export const COLUMN_LABELS = {
  pos: "Pos", number: "Nr", name: "Name", team: "Team", grid: "Start", time: "Zeit", gap: "Abstand", penalty: "Strafe",
  points: "Punkte",
};

function findRow(page, key, sessionKeyWanted) {
  const sessions = page?.sessions || [];
  const ordered = [...sessions.filter((item) => item.key === sessionKeyWanted), ...sessions];
  for (const session of ordered) {
    const row = (session.rows || []).find((item) => item.key === key);
    if (row) return row;
  }
  return null;
}

/** Wer außerhalb der Tabelle steht: ein öffentlicher Vereinsfahrer mit Namen, sonst sein Team (ohne Team: Startnummer). */
export function personLine(row, publicKeys = []) {
  if (!row) return null;
  const named = (publicKeys || []).includes(row.key) && !row.name_hidden && row.name;
  if (named) return { value: nameOf(row), team: row.team || "", color: row.team_color || null, named: true, profile: row.profile_slug || null };
  const value = row.team || (row.start_number ? `Nr. ${row.start_number}` : "–");
  return { value, team: "", color: row.team ? row.team_color || null : null, named: false, profile: null };
}

/** Die Zusammenfassung oben: Sieger, Pole, schnellste Runde, Fahrer des Tages und - je Reiter - der beste
 * Vereinsfahrer. Karten ohne Daten fallen weg. Zeiten zählen hoch (`count`). */
export function summaryCards(page, session) {
  const summary = page?.summary || {};
  const publicKeys = page?.club_drivers || [];
  const cards = [];
  const add = (key, label, entry, build) => {
    if (!entry?.key) return;
    const row = findRow(page, entry.key, entry.session);
    const person = personLine(row, publicKeys);
    if (person) cards.push({ key, label, ...person, ...build(row, person) });
  };
  add("winner", "Sieger", summary.winner, (row, person) => ({
    sub: [person.named ? person.team : "", row?.grid ? `von Startplatz ${row.grid}` : ""].filter(Boolean).join(" · "),
  }));
  add("pole", "Pole", summary.pole, () => ({ count: formatRaceTime(summary.pole?.time) }));
  add("fastest_lap", "Schnellste Runde", summary.fastest_lap, () => ({ count: formatRaceTime(summary.fastest_lap?.time) }));
  add("driver_of_the_day", "Fahrer des Tages", summary.driver_of_the_day, (row, person) => ({ sub: person.named ? person.team : "" }));
  const best = session?.best_club ? (session.rows || []).find((row) => row.key === session.best_club) : null;
  if (best) {
    const multi = (page?.sessions || []).filter((item) => item.has_result).length > 1;
    cards.push({
      key: "best_club",
      label: multi ? `Bester Vereinsfahrer · ${session.label}` : "Bester Vereinsfahrer",
      value: `${nameOf(best)} · ${best.status === "finished" && best.place ? `P${best.place}` : posLabel(best)}`,
      team: best.team || "",
      color: best.team_color || null,
      named: true,
      profile: best.profile_slug || null,
      sub: [best.team, best.points !== null && best.points !== undefined ? `${formatNumber(best.points)} ${Number(best.points) === 1 ? "Punkt" : "Punkte"}` : ""].filter(Boolean).join(" · "),
    });
  }
  return cards;
}

/** Kopf: Name der Runde (Land, sonst Titel bzw. Ort), darunter Titel bzw. Ort, wenn sie etwas anderes sagen. */
export function roundHeading(round) {
  const country = countryName(round?.country_code);
  const title = String(round?.title || "").trim();
  const venue = String(round?.venue || "").trim();
  const heading = country || title || venue || round?.code || `Runde ${round?.number || ""}`.trim();
  const sub = [title, venue].filter((part, index, list) => part && part !== heading && list.indexOf(part) === index).join(" · ");
  return { heading, sub };
}

/** Zeile über dem Namen: „Runde 1 von 24 · Do., 08.10.2026“. */
export function roundEyebrow(round) {
  const position = round?.number ? `Runde ${round.number}${round.total ? ` von ${round.total}` : ""}` : "";
  return [position, dayLabel(round?.club_day)].filter(Boolean).join(" · ");
}

/** Handy: eine Zeile unter dem Namen - „R1 · Do., 08.10.2026 · Baku City Circuit“. */
export function roundSubline(round, sub = "") {
  return [round?.code || (round?.number ? `R${round.number}` : ""), dayLabel(round?.club_day), sub].filter(Boolean).join(" · ");
}

/** Pfeil-Text zur vorigen bzw. nächsten Runde: „R2 Singapur“. */
export function neighbourLabel(item) {
  if (!item) return "";
  const place = countryName(item.country_code) || item.title || item.venue || "";
  return [item.code || `Runde ${item.number}`, place].filter(Boolean).join(" ");
}

/** Was im Reiter steht, wenn es (noch) kein Ergebnis gibt. */
export function emptyText(session) {
  if (!session) return "Für diese Runde gibt es noch keine Läufe.";
  if (session.state === "cancelled") return `${session.label} abgesagt.`;
  const when = [dayLabel(session.club_day), session.time ? `${session.time} Uhr` : ""].filter(Boolean).join(", ");
  if (session.state === "missing") return `Ergebnis folgt – ${session.label}${when ? ` am ${when}` : ""}.`;
  return `Noch kein Ergebnis – ${session.label}${when ? ` am ${when}` : ""}.`;
}
