import { dayLabel, roundLabel } from "@/lib/referenceCalendar";
import { cleanText, parseNumber, parsePlace } from "@/lib/resultPaste";

// Saisontabelle einlesen (#1928): Texte, Auswahl und Anfragen der Vorschau. Den Text liest `parseSeasonTablePaste`
// (resultPaste.js), was je Runde entsteht und welcher Platz zu den Punkten gehört, rechnet der Server – hier wird es
// nur lesbar gemacht. Vorgewählt ist nur, was nichts Vorhandenes ersetzt; gelbe Zellen klärt der Vorstand selbst.

export const KIND_OPTIONS = [
  ["name", "Fahrer"], ["team", "Team"], ["round", "Runde"], ["total", "Gesamt"], ["rank", "Platz"], ["ignore", "Nicht übernehmen"],
];

export const POINT_MODES = [
  ["scheme", "Platz aus den Punkten zurückrechnen"],
  ["organizer", "Punkte laut Veranstalter übernehmen"],
];

export const SEASON_STATES = {
  new: { label: "Neu", tone: "border-[#29B6E8]/50 text-[#29B6E8]" },
  changed: { label: "Abweichungen", tone: "border-amber-400/50 text-amber-200" },
  same: { label: "Schon übernommen", tone: "border-emerald-400/40 text-emerald-200" },
  unclear: { label: "Zum Klären", tone: "border-amber-400/60 text-amber-200" },
  error: { label: "Fehler", tone: "border-red-400/50 text-red-200" },
  empty: { label: "Keine Punkte", tone: "border-white/15 text-white/55" },
  skip: { label: "Nicht übernommen", tone: "border-white/15 text-white/55" },
  unmatched: { label: "Kein Termin", tone: "border-amber-400/50 text-amber-200" },
};

export const HOW_TEXT = {
  code: "über das Kürzel", title: "über die Strecke", country: "über die Flagge", order: "über die Reihenfolge",
  chosen: "von dir gewählt",
};

export const UNCLEAR_TEXT = {
  ambiguous: "mehrere Plätze möglich", bonus: "Bonus im Wert", outside: "nicht im Punkteschema",
  shared: "derselbe Platz zweimal in dieser Runde",
};

const SELECTABLE = new Set(["new", "changed"]);

/** Ein Termin in der Auswahl: Kürzel, Lauf, Strecke bzw. Titel und Tag. */
export function roundOption(round) {
  if (!round) return "";
  return [roundLabel(round), round.session, round.title || round.venue, dayLabel(round.club_day)].filter(Boolean).join(" · ");
}

/** Spalten der Tabelle, die Runden sind – als Index in der eingefügten Tabelle. */
export function roundColumns(kinds) {
  return kinds.map((kind, index) => (kind === "round" ? index : -1)).filter((index) => index >= 0);
}

/**
 * Anfrage an die Vorschau: Runden-Spalten (mit gewähltem Termin), Zeilen mit Name, Team, Zellen, Gesamt und Platz.
 * `roundIds[i]` gilt für Spalte `i` der Tabelle: fehlt = selbst zuordnen, "" = nicht übernehmen, sonst der Termin.
 */
export function buildBody(parsed, kinds, roundIds = {}, points = "scheme", decisions = []) {
  const nameAt = kinds.indexOf("name");
  const teamAt = kinds.indexOf("team");
  const totalAt = kinds.indexOf("total");
  const rankAt = kinds.indexOf("rank");
  const rounds = roundColumns(kinds);
  const rows = (parsed?.rows || []).filter((row) => nameAt >= 0 && cleanText(row.cells[nameAt])).map((row) => ({
    name: cleanText(row.cells[nameAt]).slice(0, 120),
    team: teamAt >= 0 ? cleanText(row.cells[teamAt]).slice(0, 120) || null : null,
    cells: rounds.map((index) => cleanText(row.cells[index]).slice(0, 20)),
    total: totalAt >= 0 ? parseNumber(row.cells[totalAt]) : null,
    rank: rankAt >= 0 ? parsePlace(row.cells[rankAt]) : null,
  }));
  const columns = rounds.map((index) => {
    const label = cleanText(parsed.columns[index]?.label).slice(0, 80);
    return roundIds[index] === undefined ? { label } : { label, round_id: roundIds[index] };
  });
  return { columns, rows, team_column: teamAt >= 0, points, decisions };
}

export function isSelectable(column) {
  return SELECTABLE.has(column?.state);
}

/** Vorgewählt ist nur Neues – ein Blatt mit Abweichungen hakt der Vorstand selbst an. */
export function defaultSelection(columns = []) {
  return columns.filter((column) => column.state === "new").map((column) => column.index);
}

/** Übernehmen: genau der Stand der Vorschau (Termin und Version) für die gewählten Spalten. */
export function applyBody(body, columns, picked) {
  const wanted = new Set(picked);
  return {
    ...body,
    items: columns.filter((column) => wanted.has(column.index) && isSelectable(column) && column.round).map((column) => ({
      column: column.index, round_id: column.round.id, expected_version: column.expected_version || 0,
    })),
  };
}

function key(column, row) {
  return `${column}:${row}`;
}

/** Gelbe Zellen aller Spalten (und schon geklärte), mit Runde, Name und Vorschlägen. `known` merkt sich Vorschläge
 * geklärter Zellen aus früheren Vorschauen. */
export function unclearCells(columns = [], rows = [], known = {}) {
  const out = [];
  for (const column of columns) {
    for (const cell of column.cells || []) {
      if (cell.state !== "unclear" && cell.code !== "decided") continue;
      const id = key(column.index, cell.row);
      const candidates = cell.candidates || known[id]?.candidates || [];
      if (cell.code === "decided" && !known[id]) continue;
      out.push({
        id, column: column.index, row: cell.row, round: column.round ? roundLabel(column.round) : column.label,
        name: rows[cell.row]?.name || "", value: cell.text, code: cell.state === "unclear" ? cell.code : known[id]?.code,
        decided: cell.code === "decided", candidates,
      });
    }
  }
  return out;
}

/** Vorschläge gelber Zellen merken (für die Auswahl, wenn die Zelle schon geklärt ist). */
export function rememberCandidates(known, columns = []) {
  const out = { ...known };
  for (const column of columns) {
    for (const cell of column.cells || []) {
      if (cell.state === "unclear") out[key(column.index, cell.row)] = { candidates: cell.candidates || [], code: cell.code };
    }
  }
  return out;
}

/** Wert einer Auswahl: „organizer“ oder der Vorschlag als Index („c0“). */
export function decisionValue(decision, candidates = []) {
  if (!decision) return "";
  if (decision.choice === "organizer") return "organizer";
  const index = candidates.findIndex((item) => item.place === decision.place
    && [...(item.bonus_keys || [])].sort().join() === [...(decision.bonus_keys || [])].sort().join()
    && [...(item.marks || [])].sort().join() === [...(decision.marks || [])].sort().join());
  return index >= 0 ? `c${index}` : "";
}

/** Auswahl → Entscheidung für den Server; leer heißt offen. */
export function decisionFor(cell, value) {
  if (value === "organizer") return { column: cell.column, row: cell.row, choice: "organizer" };
  if (!value?.startsWith("c")) return null;
  const candidate = cell.candidates[Number(value.slice(1))];
  if (!candidate) return null;
  return { column: cell.column, row: cell.row, choice: "place", place: candidate.place, bonus_keys: candidate.bonus_keys || [], marks: candidate.marks || [] };
}

/** Eindeutige Vorschläge (genau einer) für alle offenen Zellen. */
export function proposalDecisions(cells = []) {
  return cells.filter((cell) => !cell.decided && cell.candidates.length === 1).map((cell) => decisionFor(cell, "c0"));
}

/** „Punkte laut Veranstalter“ für alle offenen Zellen. */
export function organizerDecisions(cells = []) {
  return cells.filter((cell) => !cell.decided).map((cell) => decisionFor(cell, "organizer"));
}

/** Entscheidungen zusammenführen: neue ersetzen alte derselben Zelle, `null` entfernt. */
export function mergeDecisions(current = [], updates = []) {
  const map = new Map(current.map((item) => [key(item.column, item.row), item]));
  for (const [id, item] of updates) {
    if (item) map.set(id, item);
    else map.delete(id);
  }
  return [...map.values()];
}

export function cellKey(cell) {
  return key(cell.column, cell.row);
}

function signed(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  const text = String(Math.abs(Math.round(number * 100) / 100)).replace(".", ",");
  return `${number < 0 ? "−" : "+"}${text}`;
}

/** Abgleich je Fahrer in Worten: stimmt, erklärt (mit Gründen), weicht ab, ohne Gesamt. */
export function totalText(item) {
  const reasons = (list) => list.map((reason) => `${reason.text} ${signed(reason.points)}`).join(" · ");
  if (item.state === "ok") return item.reasons?.length ? `stimmt (${reasons(item.reasons)})` : "stimmt";
  if (item.state === "explained") {
    return item.explains.length === 1 ? `erklärt: ${reasons(item.explains)}` : `erklärt (${signed(item.deviation)}): ${reasons(item.explains)}`;
  }
  if (item.state === "differs") return `weicht ${signed(item.deviation)} ab${item.reasons?.length ? ` – bekannt: ${reasons(item.reasons)}` : ""}`;
  return "keine Spalte „Gesamt“";
}

export function totalsSummary(totals = []) {
  const count = (state) => totals.filter((item) => item.state === state).length;
  return { ok: count("ok"), explained: count("explained"), differs: count("differs"), none: count("no_total"),
    ranks: totals.filter((item) => item.rank_differs).length };
}

const TARGETS = {
  sheet: "Ergebnis als Entwurf",
  draft: "Entwurf wird ersetzt",
  pending_draft: "Entwurf neben dem veröffentlichten Ergebnis – du gibst ihn frei",
};

/** Was mit dem Ergebnis der Runde passiert. */
export function targetText(column) {
  if (!column.round) return column.state === "skip" ? "Spalte wird nicht übernommen" : "Bitte einen Termin wählen";
  if (column.state === "same") return "Ergebnis stimmt mit der Tabelle überein";
  if (column.state === "empty") return "niemand mit Punkten in dieser Spalte";
  return TARGETS[column.target] || TARGETS.sheet;
}

// ---------------------------------------------------------------- Bild (#1999)
// Die Bild-Erkennung liefert Spalten mit Art (`rank`, `name`, `team`, `round`, `total`, `gap`) und je Zeile die Zellen
// als Text samt gelben Zellen. Fahrer-Tabellen werden zur eingefügten Tabelle (derselbe Weg wie Text), Team-Tabellen
// zur Teamwertung laut Veranstalter.
const IMAGE_KINDS = { gap: "ignore" };

/** Die gelesene Tabelle wie eingefügter Text (`parseSeasonTablePaste`) - dazu je Zeile die gelben Zellen. */
export function imageTable(result) {
  const columns = (result?.columns || []).map((column) => ({ label: column.label, kind: IMAGE_KINDS[column.kind] || column.kind }));
  const nameAt = columns.findIndex((column) => column.kind === "name");
  const rows = (result?.rows || []).map((row, index) => ({ line: index + 1, cells: [...row.cells] }));
  const marks = (result?.rows || []).flatMap((row, index) => (row.uncertain?.length ? [{
    row: index, name: row.cells[nameAt] || `Zeile ${index + 1}`,
    cells: row.uncertain.map((column) => ({ column, label: columns[column]?.label || "", value: row.cells[column], read: row.read?.[String(column)] || "" })),
    notes: row.notes || [],
  }] : []));
  return { parsed: { format: "image", header: true, columns, rows, errors: [] }, marks };
}

/** Die Tabelle als Text mit Tab - so lässt sie sich im Feld prüfen und korrigieren. */
export function tableText(parsed) {
  const head = (parsed?.columns || []).map((column) => column.label).join("\t");
  return [head, ...(parsed?.rows || []).map((row) => row.cells.join("\t"))].join("\n");
}

const MARKS_SHOWN = 4;

/** Eine gelbe Zeile in Worten: „Runde 3: 50 (gelesen 30) · Punkte: 545“ - Zellen mit anderer Lesung zuerst, höchstens
 * vier, dann „+ 9 weitere“ (passt die Summe nicht, ist die ganze Zeile gelb). */
export function markText(mark) {
  const ordered = [...mark.cells.filter((cell) => cell.read), ...mark.cells.filter((cell) => !cell.read)];
  const shown = ordered.slice(0, MARKS_SHOWN).map((cell) => `${cell.label}: ${cell.value || "leer"}${cell.read ? ` (gelesen ${cell.read})` : ""}`);
  const rest = ordered.length - MARKS_SHOWN;
  return [...shown, ...(rest > 0 ? [`+ ${rest} weitere`] : [])].join(" · ");
}

/** Die letzte Runde der Tabelle (#1933: dort hängt das Bild als Original) - im Kalender die späteste mit Spalte. */
export function lastTableRound(columns = []) {
  return columns.filter((column) => column.round && column.state !== "skip")
    .reduce((last, column) => (!last || (column.round.position ?? 0) >= (last.position ?? 0) ? column.round : last), null);
}

/** Team-Tabelle → Zeilen der Teamwertung laut Veranstalter: Team und Punkte, gelb, wenn eins davon unsicher ist; der
 * Hinweis an der Summe (etwa „Summe der Runden ≠ Punkte“ bei aktueller Besetzung, #1960) geht als `hint` mit. */
export function imageTeamRows(result) {
  const kinds = (result?.columns || []).map((column) => column.kind);
  const nameAt = kinds.indexOf("name");
  const totalAt = kinds.indexOf("total");
  if (nameAt < 0 || totalAt < 0) return [];
  return (result.rows || []).filter((row) => row.cells[nameAt]).map((row) => {
    const uncertain = (row.uncertain || []).filter((column) => column === nameAt || column === totalAt);
    const read = uncertain.map((column) => row.read?.[String(column)]).filter(Boolean).join(" · ");
    return { team: row.cells[nameAt], points: row.cells[totalAt], ocr: uncertain.length ? { read } : null, hint: (row.notes || []).join(" · ") };
  });
}

/** Rückmeldung nach dem Übernehmen. */
export function applySummary(items = []) {
  const count = (status) => items.filter((item) => item.status === status).length;
  const saved = count("saved");
  const unclear = count("unclear");
  const conflicts = count("conflict");
  const errors = count("error");
  const parts = [];
  if (saved) parts.push(`${saved} ${saved === 1 ? "Runde" : "Runden"} als Entwurf übernommen`);
  if (unclear) parts.push(`${unclear} mit offenen gelben Zellen`);
  if (conflicts) parts.push(`${conflicts} hat sich seit der Vorschau geändert`);
  if (errors) parts.push(`${errors} mit Fehler`);
  if (!parts.length) return { ok: true, text: "Nichts zu übernehmen – alles ist schon da." };
  return { ok: !unclear && !conflicts && !errors, text: `${parts.join(" · ")}.` };
}
