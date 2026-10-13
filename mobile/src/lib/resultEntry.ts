// Ergebnis-Fenster (#1156, #1370): was die Eingabe ohne Zahlentastatur dem Server schickt - und der Satz davor.
// Dieselbe Rechnung wie auf der Website (frontend/src/lib/resultEntry.js); beide prüfen die Fälle in
// frontend/src/lib/resultEntry.cases.json. Der Server prüft jedes Ergebnis noch einmal und hält es 10 Sekunden für
// „Rückgängig“ zurück.

export const UNDO_SECONDS = 10;
export type SideFlag = "no_show" | "gave_up";
export const FLAG_LABELS: Record<SideFlag, string> = { no_show: "Nicht erschienen", gave_up: "Aufgegeben" };
export type HeatMode = "order" | "points";
export type InputKind = "score" | "bestof" | "winner" | "order" | "points";

export type ResultRow = { registration_id: string; rank: number; score?: number; dnf?: boolean; forfeit?: boolean };
export type Outcome = { results: ResultRow[]; error?: undefined } | { error: string; results?: undefined };
export type Flags = Record<string, SideFlag | null | undefined>;

export type EntryParticipant = { registration_id: string; name?: string | null; slot?: number | null };
export type ResultEntry = {
  id: string;
  match_key?: string | null;
  label?: string | null;
  stage_name?: string | null;
  status?: string | null;
  kind: "duel" | "heat" | string;
  best_of?: number | null;
  ranking_mode?: "higher_score" | "lower_score" | "time" | string | null;
  allows_draw?: boolean;
  participants: EntryParticipant[];
  advance?: Record<string, { text?: string; flow?: string } | undefined>;
  has_result?: boolean;
  result?: Array<Partial<ResultRow> & { registration_id: string; points?: number }>;
  result_summary?: string | null;
  hold?: { id?: string; publish_at?: string; mine?: boolean; actor_name?: string; correction?: boolean } | null;
  station_id?: string | null;
  station_text?: string | null;
  scheduled_at?: string | null;
  started_at?: string | null;
  timing?: { running_minutes?: number | null; overdue_minutes?: number | null; missing?: boolean } | null;
  can_enter?: boolean;
  // Streitfall (#1158): nur in der Ansicht der Turnierleitung.
  dispute?: {
    at?: string | null;
    by?: string;
    category?: string;
    category_label?: string;
    text?: string;
    photo?: { id: string; url: string } | null;
    result_at?: string | null;
    result_by?: string | null;
    reports?: Array<{ by?: string; summary?: string; at?: string; photo?: { id: string; url: string } | null }>;
  } | null;
};

export type EntryState = {
  sides: string[];
  flags: Flags;
  scores: Record<string, number>;
  order: string[];
  winner: string;
  games: Array<string | null>;
};

export function inputKind(entry: Pick<ResultEntry, "kind" | "best_of" | "ranking_mode"> | null | undefined, heatMode: HeatMode = "order"): InputKind {
  if (!entry || entry.kind !== "duel") return heatMode === "points" && entry?.ranking_mode !== "time" ? "points" : "order";
  if (entry.ranking_mode === "time") return "winner";
  // Best-of zählt gewonnene Spiele - nur wo der höhere Stand gewinnt; so prüft es auch der Server (#1035).
  return Number(entry.best_of || 1) > 1 && entry.ranking_mode !== "lower_score" ? "bestof" : "score";
}

export function winsNeeded(bestOf: number | null | undefined) {
  return Math.floor(Number(bestOf || 1) / 2) + 1;
}

function withScore(row: ResultRow, value: number | string | null | undefined): ResultRow {
  return value === undefined || value === null || value === "" ? row : { ...row, score: Number(value) };
}

function flagged(sides: string[], flags: Flags = {}) {
  return sides.filter((id) => flags[id] === "no_show" || flags[id] === "gave_up");
}

function duelWithFlag(sides: string[], flags: Flags, values: Record<string, number | undefined>): Outcome {
  const [a, b] = sides;
  const loser = flagged(sides, flags)[0];
  const winner = loser === a ? b : a;
  if (flags[loser] === "no_show") {
    return { results: [{ registration_id: winner, rank: 1 }, { registration_id: loser, rank: 2, forfeit: true }] };
  }
  return { results: [withScore({ registration_id: winner, rank: 1 }, values?.[winner]), withScore({ registration_id: loser, rank: 2, dnf: true }, values?.[loser])] };
}

const BOTH_FLAGGED = "Nur eine Seite kann „Nicht erschienen“ oder „Aufgegeben“ haben.";
const NO_SIDES = "Für dieses Spiel stehen noch nicht beide Seiten fest.";

export function scoreResults({ sides = [], scores = {}, flags = {}, mode = "higher_score", allowsDraw = false }: {
  sides?: string[]; scores?: Record<string, number>; flags?: Flags; mode?: string | null; allowsDraw?: boolean;
} = {}): Outcome {
  const [a, b] = sides;
  if (!a || !b) return { error: NO_SIDES };
  if (flagged(sides, flags).length > 1) return { error: BOTH_FLAGGED };
  if (flagged(sides, flags).length === 1) return duelWithFlag(sides, flags, scores);
  const first = Number(scores[a] || 0);
  const second = Number(scores[b] || 0);
  if (first === second) {
    if (!allowsDraw) return { error: "Gleichstand geht in diesem Spiel nicht – eine Seite muss gewinnen." };
    return { results: [{ registration_id: a, rank: 1, score: first }, { registration_id: b, rank: 1, score: second }] };
  }
  const aWins = mode === "lower_score" ? first < second : first > second;
  const [winner, loser] = aWins ? [a, b] : [b, a];
  return { results: [{ registration_id: winner, rank: 1, score: Number(scores[winner] || 0) }, { registration_id: loser, rank: 2, score: Number(scores[loser] || 0) }] };
}

export function bestOfResults({ sides = [], games = [], bestOf = 3, flags = {} }: {
  sides?: string[]; games?: Array<string | null>; bestOf?: number | null; flags?: Flags;
} = {}): Outcome {
  const [a, b] = sides;
  if (!a || !b) return { error: NO_SIDES };
  if (flagged(sides, flags).length > 1) return { error: BOTH_FLAGGED };
  const wins: Record<string, number> = { [a]: 0, [b]: 0 };
  for (const game of games) if (game === a || game === b) wins[game] += 1;
  if (flagged(sides, flags).length === 1) return duelWithFlag(sides, flags, wins);
  const needed = winsNeeded(bestOf);
  const winner = wins[a] >= needed ? a : wins[b] >= needed ? b : null;
  if (!winner) return { error: `Noch nicht entschieden – es braucht ${needed} gewonnene Spiele.` };
  const loser = winner === a ? b : a;
  return { results: [{ registration_id: winner, rank: 1, score: wins[winner] }, { registration_id: loser, rank: 2, score: wins[loser] }] };
}

export function tapGame(games: Array<string | null> = [], index: number, winner: string, { sides = [], bestOf = 3 }: { sides?: string[]; bestOf?: number | null } = {}) {
  const next = [...games];
  next[index] = next[index] === winner ? null : winner;
  const needed = winsNeeded(bestOf);
  const wins: Record<string, number> = Object.fromEntries(sides.map((id) => [id, 0]));
  return next.map((game) => {
    if (Object.values(wins).some((count) => count >= needed)) return null;
    if (game && game in wins) wins[game] += 1;
    return game ?? null;
  });
}

export function winnerResults({ sides = [], winner = "", flags = {} }: { sides?: string[]; winner?: string; flags?: Flags } = {}): Outcome {
  const [a, b] = sides;
  if (!a || !b) return { error: NO_SIDES };
  if (flagged(sides, flags).length > 1) return { error: BOTH_FLAGGED };
  if (flagged(sides, flags).length === 1) return duelWithFlag(sides, flags, {});
  if (winner !== a && winner !== b) return { error: "Bitte antippen, wer gewonnen hat." };
  return { results: [{ registration_id: winner, rank: 1 }, { registration_id: winner === a ? b : a, rank: 2 }] };
}

function flagTail(ids: string[], flags: Flags, startRank: number): ResultRow[] {
  const gaveUp = ids.filter((id) => flags[id] === "gave_up");
  const noShow = ids.filter((id) => flags[id] === "no_show");
  return [
    ...gaveUp.map((id, index) => ({ registration_id: id, rank: startRank + index, dnf: true })),
    ...noShow.map((id, index) => ({ registration_id: id, rank: startRank + gaveUp.length + index, forfeit: true })),
  ];
}

export function orderResults({ all = [], order = [], flags = {} }: { all?: string[]; order?: string[]; flags?: Flags } = {}): Outcome {
  if (all.length < 2) return { error: "Für dieses Spiel stehen noch nicht alle Teilnehmer fest." };
  const racing = all.filter((id) => !flags[id]);
  const placed = [...new Set(order)].filter((id) => racing.includes(id));
  const missing = racing.length - placed.length;
  if (missing > 0) return { error: `Bitte alle in Zielreihenfolge antippen – ${missing === 1 ? "einer fehlt" : `${missing} fehlen`} noch.` };
  const results: ResultRow[] = placed.map((id, index) => ({ registration_id: id, rank: index + 1 }));
  return { results: [...results, ...flagTail(all, flags, results.length + 1)] };
}

export function pointsResults({ all = [], points = {}, flags = {}, mode = "higher_score", allowsDraw = false, names = {} }: {
  all?: string[]; points?: Record<string, number>; flags?: Flags; mode?: string | null; allowsDraw?: boolean; names?: Record<string, string | null | undefined>;
} = {}): Outcome {
  if (all.length < 2) return { error: "Für dieses Spiel stehen noch nicht alle Teilnehmer fest." };
  const racing = all.filter((id) => !flags[id]);
  const value = (id: string) => Number(points[id] || 0);
  const sorted = [...racing].sort((left, right) => (mode === "lower_score" ? value(left) - value(right) : value(right) - value(left)));
  if (!allowsDraw) {
    const tie = sorted.findIndex((id, index) => index > 0 && value(id) === value(sorted[index - 1]));
    if (tie > 0) {
      return { error: `Gleich viele Punkte bei ${names[sorted[tie - 1]] || "zwei Fahrern"} und ${names[sorted[tie]] || "einem anderen"} – bitte prüfen oder die Reihenfolge antippen.` };
    }
  }
  const results: ResultRow[] = [];
  sorted.forEach((id, index) => {
    const previous = results[index - 1];
    const rank = previous && previous.score === value(id) ? previous.rank : index + 1;
    results.push({ registration_id: id, rank, score: value(id) });
  });
  return { results: [...results, ...flagTail(all, flags, results.length + 1)] };
}

function joinNames(names: string[]) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function valueText(row?: ResultRow) {
  if (row?.score === undefined || row?.score === null) return null;
  const value = Number(row.score);
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

export function resultSentence(entry: Pick<ResultEntry, "kind" | "participants" | "advance"> | null | undefined, results: ResultRow[] = []) {
  const names: Record<string, string> = Object.fromEntries((entry?.participants || []).map((row) => [row.registration_id, row.name || "Teilnehmer"]));
  const ordered = [...results].sort((left, right) => Number(left.rank) - Number(right.rank));
  if (!ordered.length) return "";
  const advance = entry?.advance || {};
  if (entry?.kind === "duel" && ordered.length === 2) {
    const [top, bottom] = ordered;
    const next = advance["1"]?.text ? ` – weiter ${advance["1"].text}` : "";
    const topValue = valueText(top);
    const bottomValue = valueText(bottom);
    const score = topValue !== null && bottomValue !== null ? ` ${topValue}:${bottomValue}` : "";
    if (Number(top.rank) === Number(bottom.rank)) return `Unentschieden${score}`;
    if (bottom.forfeit) return `${names[top.registration_id]} gewinnt kampflos, ${names[bottom.registration_id]} ist nicht erschienen${next}`;
    if (bottom.dnf) return `${names[top.registration_id]} gewinnt${score}, ${names[bottom.registration_id]} hat aufgegeben${next}`;
    return `${names[top.registration_id]} gewinnt${score}${next}`;
  }
  const forward = ordered.filter((row) => advance[String(row.rank)]?.flow !== "L" && advance[String(row.rank)]?.text && !row.forfeit && !row.dnf);
  if (forward.length) return `Weiter: ${joinNames(forward.map((row) => names[row.registration_id]))}`;
  const top = ordered.slice(0, 3).map((row) => `${row.rank}. ${names[row.registration_id]}`);
  const more = ordered.length > 3 ? ` · +${ordered.length - 3} weitere` : "";
  return `${top.join(" · ")}${more}`;
}

export function initialState(entry: ResultEntry | null | undefined): EntryState {
  const sides = (entry?.participants || []).map((row) => row.registration_id);
  const byId = Object.fromEntries((entry?.result || []).map((row) => [row.registration_id, row]));
  const flags: Flags = {};
  const scores: Record<string, number> = {};
  for (const id of sides) {
    const row = byId[id];
    if (row?.forfeit) flags[id] = "no_show";
    else if (row?.dnf) flags[id] = "gave_up";
    scores[id] = Number(row?.score ?? row?.points ?? 0);
  }
  const order = [...(entry?.result || [])].filter((row) => !row.forfeit && !row.dnf).sort((a, b) => Number(a.rank) - Number(b.rank)).map((row) => row.registration_id);
  const winner = (entry?.result || []).find((row) => Number(row.rank) === 1 && !row.forfeit && !row.dnf)?.registration_id || "";
  return { sides, flags, scores, order, winner, games: [] };
}

export function resultsFor(entry: ResultEntry, kind: InputKind, state: EntryState): Outcome {
  const sides = (entry?.participants || []).map((row) => row.registration_id);
  const names = Object.fromEntries((entry?.participants || []).map((row) => [row.registration_id, row.name]));
  const flags = state.flags || {};
  if (kind === "score") return scoreResults({ sides, scores: state.scores || {}, mode: entry.ranking_mode, allowsDraw: Boolean(entry.allows_draw), flags });
  if (kind === "bestof") return bestOfResults({ sides, games: state.games || [], bestOf: entry.best_of, flags });
  if (kind === "winner") return winnerResults({ sides, winner: state.winner, flags });
  if (kind === "points") return pointsResults({ all: sides, points: state.scores || {}, mode: entry.ranking_mode, allowsDraw: Boolean(entry.allows_draw), names, flags });
  return orderResults({ all: sides, order: state.order || [], flags });
}

/** Ein Flag setzen; im Duell kann nur eine Seite markiert sein - der Tipp auf der anderen Seite verschiebt es. */
export function withFlag(state: EntryState, id: string, flag: SideFlag | null, exclusive = false): EntryState {
  const flags: Flags = exclusive ? {} : { ...state.flags };
  if (flag) flags[id] = flag;
  else delete flags[id];
  const order = (state.order || []).filter((item) => item !== id || !flag);
  return { ...state, flags, order };
}
