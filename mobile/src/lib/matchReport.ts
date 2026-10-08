// Ergebnis melden (#1132): Online melden die Spieler ihr Ergebnis selbst, die Gegenseite bestätigt. Dieselbe Rechnung
// wie auf der Website (frontend/src/lib/matchReport.js) - die Fälle in frontend/src/lib/matchReport.cases.json prüfen
// beide. Der Server prüft noch einmal und rechnet die Platzierung aus dem Spielstand nach.

export type RankingMode = "time" | "lower_score" | "higher_score";
export type ReportEntry = { registration_id: string; rank: number; score?: number; time_ms?: number };
export type ReportOutcome = { results: ReportEntry[]; error?: undefined } | { error: string; results?: undefined };

/** Wie gewertet wird: Zeit (schnellste gewinnt), niedrigster Score oder höchste Punkte. */
export function rankingMode(match: { settings?: Record<string, unknown> | null } | null | undefined): RankingMode {
  const raw = String(match?.settings?.calculation || match?.settings?.score_type || "points").toLowerCase().replace(/[-\s]/g, "_");
  if (["time", "time_ms", "fastest", "fastest_lap", "lowest_time", "best_time"].includes(raw)) return "time";
  if (["lower_score", "lowest_score", "low_score", "strokes", "penalty_points"].includes(raw)) return "lower_score";
  return "higher_score";
}

/** Eine Zahl aus dem Feld: leer heißt „nichts angegeben“ (null), Unsinn heißt `undefined`. */
export function fieldNumber(value: unknown): number | null | undefined {
  const text = String(value ?? "").trim().replace(",", ".");
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

function better(first: number, second: number, mode: RankingMode) {
  if (first === second) return 0;
  const firstWins = mode === "higher_score" ? first > second : first < second;
  return firstWins ? -1 : 1;
}

function withValue(entry: ReportEntry, field: "score" | "time_ms", value: number | null): ReportEntry {
  return value === null ? entry : { ...entry, [field]: value };
}

/**
 * Ein Duell melden: wer gewonnen hat - oder „draw“ für Unentschieden - und freiwillig der Spielstand beider Seiten.
 * Gibt `{ results }` für den Server zurück oder `{ error }` mit dem Satz für die Seite.
 */
export function duelResults({ sides = [], winner = "", values = {}, mode = "higher_score" }: {
  sides?: string[];
  winner?: string;
  values?: Record<string, string>;
  mode?: RankingMode;
} = {}): ReportOutcome {
  const [first, second] = sides;
  if (!first || !second) return { error: "Für dieses Spiel stehen noch nicht beide Seiten fest." };
  if (!winner) return { error: "Bitte wähle, wer gewonnen hat." };
  if (winner !== "draw" && winner !== first && winner !== second) return { error: "Bitte wähle, wer gewonnen hat." };
  const a = fieldNumber(values[first]);
  const b = fieldNumber(values[second]);
  if (a === undefined || b === undefined) return { error: "Beim Spielstand bitte nur Zahlen eintragen." };
  if ((a === null) !== (b === null)) return { error: "Bitte den Spielstand für beide Seiten eintragen – oder für keine." };
  if (a !== null && b !== null) {
    const expected = winner === "draw" ? 0 : winner === first ? -1 : 1;
    if (better(a, b, mode) !== expected) return { error: "Der Spielstand passt nicht zum Sieger." };
  }
  const field = mode === "time" ? "time_ms" : "score";
  const top = winner === "draw" ? first : winner;
  const other = top === first ? second : first;
  const valueOf = (id: string) => (id === first ? a : b);
  return {
    results: [
      withValue({ registration_id: top, rank: 1 }, field, valueOf(top)),
      withValue({ registration_id: other, rank: winner === "draw" ? 1 : 2 }, field, valueOf(other)),
    ],
  };
}

/**
 * Einen Durchgang melden: je Teilnehmer der Platz und freiwillig Punkte oder Zeit. Jeder Platz von 1 bis n genau
 * einmal - wer Punkte oder Zeiten einträgt, bekommt die Plätze vom Server danach gerechnet.
 */
export function heatResults(rows: Array<{ registration_id: string; rank: string; value: string }> = [], mode: RankingMode = "higher_score"): ReportOutcome {
  if (rows.length < 2) return { error: "Für dieses Spiel stehen noch nicht alle Teilnehmer fest." };
  const field = mode === "time" ? "time_ms" : "score";
  const seen = new Set<number>();
  const results: ReportEntry[] = [];
  for (const row of rows) {
    const rank = Number(String(row.rank ?? "").trim());
    if (!Number.isInteger(rank) || rank < 1 || rank > rows.length) return { error: `Bitte für jeden einen Platz von 1 bis ${rows.length} eintragen.` };
    if (seen.has(rank)) return { error: `Platz ${rank} ist doppelt vergeben.` };
    seen.add(rank);
    const value = fieldNumber(row.value);
    if (value === undefined) return { error: "Bei Punkten und Zeiten bitte nur Zahlen eintragen." };
    results.push(withValue({ registration_id: row.registration_id, rank }, field, value));
  }
  return { results: results.sort((left, right) => left.rank - right.rank) };
}

/** Was nach dem Melden dasteht (#1132) - je nach Stand der Meldungen. */
export const REPORT_STATE_TEXT: Record<string, string> = {
  waiting: "Deine Meldung ist da – wartet auf die Gegenseite.",
  conflict: "Die Meldungen weichen ab – die Turnierleitung entscheidet.",
  confirm: "Die Gegenseite hat ein Ergebnis gemeldet. Stimmt es?",
};
