// Tabellen (#1562, #1179): was die Rangliste aus /api/tournaments/:id/standings liest. Der Server rechnet alles -
// Punkte, Differenz, Form und den Platz nach dem vorigen Spieltag (`previous_rank`); hier wird nur sortiert,
// beschriftet und in Abschnitte geteilt. Gruppen kommen als `[{ group, standings }]`, alles andere als Zeilenliste.

const FORM_WORDS = { W: "Sieg", D: "Unentschieden", L: "Niederlage" };
// Kurz in der Tabelle: S, U, N wie im Fußball.
export const FORM_LETTERS = { W: "S", D: "U", L: "N" };

function isGroupEntry(entry) {
  return !!entry && typeof entry === "object" && Array.isArray(entry.standings);
}

/** Abschnitte der Rangliste: je Gruppe eine Tabelle (mit Namen), sonst eine ohne Überschrift. */
export function standingSections(data) {
  const list = Array.isArray(data) ? data : [];
  if (!list.some(isGroupEntry)) {
    return [{ key: "all", label: "", rows: list, mine: list.some((row) => row?.is_mine) }];
  }
  return list.filter(isGroupEntry).map((entry, index) => {
    const group = entry.group || {};
    const label = group.name || (group.group_key ? `Gruppe ${String(group.group_key).toUpperCase()}` : `Gruppe ${index + 1}`);
    return { key: group.id || group.group_key || `group-${index}`, label, rows: entry.standings, mine: entry.standings.some((row) => row?.is_mine) };
  });
}

/** „league“: Liga, Round Robin, Gruppen (mit Differenz) und Schweizer System (mit Buchholz); sonst „knockout“. */
export function tableKind(rows) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((row) => row && "score_diff" in row)) return "league";
  if (list.some((row) => row && "buchholz" in row)) return "swiss";
  return "knockout";
}

/** Bewegung seit dem vorigen Spieltag - `null`, solange es keinen gibt. */
export function rankMove(row) {
  const before = Number(row?.previous_rank);
  const now = Number(row?.rank);
  if (row?.previous_rank == null || !Number.isFinite(before) || !Number.isFinite(now)) return null;
  const by = before - now;
  if (by > 0) return { direction: "up", by };
  if (by < 0) return { direction: "down", by: -by };
  return { direction: "same", by: 0 };
}

function number(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
}

/** Differenz mit Vorzeichen; das Minus ist ein echtes Minuszeichen, damit die Ziffern gleich breit bleiben. */
export function formatDiff(value) {
  const n = number(value);
  if (n > 0) return `+${n}`;
  if (n < 0) return `−${Math.abs(n)}`;
  return "0";
}

export function formatNumber(value) {
  return String(number(value)).replace(".", ",");
}

/** Die Form für Screenreader und Tooltip. */
export function formLabel(form) {
  const list = (form || []).filter((letter) => FORM_WORDS[letter]);
  if (!list.length) return "Noch keine Spiele";
  return `Form: ${list.map((letter) => FORM_WORDS[letter]).join(", ")}`;
}
