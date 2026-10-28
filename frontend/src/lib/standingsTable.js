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

/**
 * „league“: Liga, Round Robin, Gruppen (mit Differenz); „swiss“: Schweizer System (mit Buchholz); sonst „knockout“ - oder
 * „ffa“, wenn das Turnier in Läufen spielt (`heats`, #2121): dort zählen Punkte und der Platz im Schnitt, keine Niederlagen.
 */
export function tableKind(rows, { heats = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (list.some((row) => row && "score_diff" in row)) return "league";
  if (list.some((row) => row && "buchholz" in row)) return "swiss";
  return heats ? "ffa" : "knockout";
}

/** Der Kopf der Namensspalte (#2121): „Team“ bei Team-Turnieren, sonst „Name“. */
export function nameHead(tournament) {
  return (tournament?.team_mode || "solo") !== "solo" ? "Team" : "Name";
}

const PLAYED = { key: "played", label: "Sp", title: "Spiele" };
const WON = { key: "won", label: "S", title: "Siege", wide: true };
const DRAWN = { key: "drawn", label: "U", title: "Unentschieden", wide: true };
const LOST = { key: "lost", label: "N", title: "Niederlagen", wide: true };
const DIFF = { key: "score_diff", label: "Diff", title: "Differenz", format: (value) => formatDiff(value) };
const FORM = { key: "form", label: "Form", title: "Die letzten fünf Spiele" };
const POINTS = { key: "points", label: "Pkt", title: "Punkte", strong: true };

/**
 * Die Spalten der Rangliste je Art (#1562, #2121) - Website, TV und Druck zeigen dieselben. `read`: der Wert aus der
 * Zeile, `format`: wie er dasteht, `wide`: am Handy ausgeblendet, `strong`: die entscheidende Zahl (zählt hoch).
 * Im K.-o. gibt es keine Punkte - dort zählt die erreichte Runde.
 */
export const STANDING_COLUMNS = Object.freeze({
  league: [PLAYED, WON, DRAWN, LOST, DIFF, FORM, POINTS],
  swiss: [PLAYED, WON, DRAWN, LOST, { key: "buchholz", label: "BHZ", title: "Buchholz: Punkte der Gegner" }, FORM, POINTS],
  // Team-Liga externer Serien (#1747): wie die Liga, dazu die Maps (gewonnen:verloren).
  team_league: [PLAYED, WON, DRAWN, LOST,
    { key: "maps", label: "Maps", title: "Maps gewonnen : verloren", wide: true, read: (row) => `${formatNumber(row.score_for ?? 0)}:${formatNumber(row.score_against ?? 0)}` },
    DIFF, FORM, POINTS],
  ffa: [PLAYED, { key: "won", label: "S", title: "Siege", read: (row) => row.won ?? row.wins ?? 0 },
    { key: "avg_rank", label: "Ø Pl.", title: "Platz im Schnitt", wide: true, read: (row) => (row.avg_rank == null ? "–" : formatNumber(row.avg_rank)) },
    POINTS],
  knockout: [
    { key: "won", label: "S", title: "Siege", read: (row) => row.won ?? row.wins ?? 0 },
    { key: "lost", label: "N", title: "Niederlagen", read: (row) => row.lost ?? row.losses ?? 0 },
    { key: "furthest_round", label: "Runde", title: "Erreichte Runde", strong: true, read: (row) => row.furthest_round ?? 0 },
  ],
});

/** Der Text einer Zelle (Form ausgenommen - die ist ein Bild aus Punkten). */
export function standingCell(column, row) {
  if (column.read) return column.read(row);
  if (column.format) return column.format(row[column.key]);
  return formatNumber(row[column.key] ?? 0);
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
