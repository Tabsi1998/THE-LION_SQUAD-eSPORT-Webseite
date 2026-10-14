// Ergebnis-Fenster (#1156, #1370): was die Eingabe ohne Zahlentastatur dem Server schickt - und der Satz davor.
//
// Dieselbe Rechnung steht in der App (mobile/src/lib/resultEntry.ts); beide prüfen die Fälle in
// resultEntry.cases.json. Der Server prüft jedes Ergebnis noch einmal (services/match_v2_results) und hält es
// 10 Sekunden für „Rückgängig“ zurück (services/result_hold).
//
// Wörter wie im Ergebnis-Fenster: „Nicht erschienen“ (der Server kennt es als forfeit) und „Aufgegeben“ (dnf).

export const UNDO_SECONDS = 10;
export const FLAG_LABELS = { no_show: "Nicht erschienen", gave_up: "Aufgegeben" };
export const HEAT_MODES = [["order", "Reihenfolge"], ["points", "Punkte"]];
export const HEAT_MODE_KEY = "tls_result_heat_mode";

/** Welche Eingabe zum Spiel passt: Stand mit Plus/Minus, Best-of, Sieger antippen oder bei Durchgängen die Wahl. */
export function inputKind(entry, heatMode = "order") {
  if (!entry || entry.kind !== "duel") return heatMode === "points" && entry?.ranking_mode !== "time" ? "points" : "order";
  if (entry.ranking_mode === "time") return "winner";
  // Best-of zählt gewonnene Spiele - nur wo der höhere Stand gewinnt; so prüft es auch der Server (#1035).
  return Number(entry.best_of || 1) > 1 && entry.ranking_mode !== "lower_score" ? "bestof" : "score";
}

export function winsNeeded(bestOf) {
  return Math.floor(Number(bestOf || 1) / 2) + 1;
}

function withScore(row, value) {
  return value === undefined || value === null || value === "" ? row : { ...row, score: Number(value) };
}

function flagged(sides, flags = {}) {
  return sides.filter((id) => flags[id] === "no_show" || flags[id] === "gave_up");
}

function duelWithFlag(sides, flags, values) {
  const [a, b] = sides;
  const loser = flagged(sides, flags)[0];
  const winner = loser === a ? b : a;
  if (flags[loser] === "no_show") {
    return { results: [{ registration_id: winner, rank: 1 }, { registration_id: loser, rank: 2, forfeit: true }] };
  }
  return {
    results: [withScore({ registration_id: winner, rank: 1 }, values?.[winner]), withScore({ registration_id: loser, rank: 2, dnf: true }, values?.[loser])],
  };
}

/** 1 gegen 1 mit Stand (Plus/Minus). Gleichstand nur, wo er erlaubt ist (Gruppe, Liga). */
export function scoreResults({ sides = [], scores = {}, flags = {}, mode = "higher_score", allowsDraw = false } = {}) {
  const [a, b] = sides;
  if (!a || !b) return { error: "Für dieses Spiel stehen noch nicht beide Seiten fest." };
  if (flagged(sides, flags).length > 1) return { error: "Nur eine Seite kann „Nicht erschienen“ oder „Aufgegeben“ haben." };
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

/** Best-of: je Spiel den Sieger antippen - der Endstand ergibt sich aus den gewonnenen Spielen. */
export function bestOfResults({ sides = [], games = [], bestOf = 3, flags = {} } = {}) {
  const [a, b] = sides;
  if (!a || !b) return { error: "Für dieses Spiel stehen noch nicht beide Seiten fest." };
  if (flagged(sides, flags).length > 1) return { error: "Nur eine Seite kann „Nicht erschienen“ oder „Aufgegeben“ haben." };
  const wins = { [a]: 0, [b]: 0 };
  for (const game of games) if (game === a || game === b) wins[game] += 1;
  if (flagged(sides, flags).length === 1) return duelWithFlag(sides, flags, wins);
  const needed = winsNeeded(bestOf);
  const winner = wins[a] >= needed ? a : wins[b] >= needed ? b : null;
  if (!winner) return { error: `Noch nicht entschieden – es braucht ${needed} gewonnene Spiele.` };
  const loser = winner === a ? b : a;
  return { results: [{ registration_id: winner, rank: 1, score: wins[winner] }, { registration_id: loser, rank: 2, score: wins[loser] }] };
}

/** Nach einem Tipp auf den Sieger eines Spiels: die Liste der Spiele ohne alles, was nach der Entscheidung kommt. */
export function tapGame(games = [], index, winner, { sides = [], bestOf = 3 } = {}) {
  const next = [...games];
  next[index] = next[index] === winner ? null : winner;
  const needed = winsNeeded(bestOf);
  const wins = Object.fromEntries(sides.map((id) => [id, 0]));
  return next.map((game) => {
    if (Object.values(wins).some((count) => count >= needed)) return null;
    if (game && game in wins) wins[game] += 1;
    return game;
  });
}

/** Zeitduell: nur antippen, wer gewonnen hat. */
export function winnerResults({ sides = [], winner = "", flags = {} } = {}) {
  const [a, b] = sides;
  if (!a || !b) return { error: "Für dieses Spiel stehen noch nicht beide Seiten fest." };
  if (flagged(sides, flags).length > 1) return { error: "Nur eine Seite kann „Nicht erschienen“ oder „Aufgegeben“ haben." };
  if (flagged(sides, flags).length === 1) return duelWithFlag(sides, flags, {});
  if (winner !== a && winner !== b) return { error: "Bitte antippen, wer gewonnen hat." };
  return { results: [{ registration_id: winner, rank: 1 }, { registration_id: winner === a ? b : a, rank: 2 }] };
}

function flagTail(ids, flags, startRank) {
  const gaveUp = ids.filter((id) => flags[id] === "gave_up");
  const noShow = ids.filter((id) => flags[id] === "no_show");
  return [
    ...gaveUp.map((id, index) => ({ registration_id: id, rank: startRank + index, dnf: true })),
    ...noShow.map((id, index) => ({ registration_id: id, rank: startRank + gaveUp.length + index, forfeit: true })),
  ];
}

/** Durchgang per Zielreihenfolge: die Fahrer in der Reihenfolge antippen, wie sie ins Ziel kamen. */
export function orderResults({ all = [], order = [], flags = {} } = {}) {
  if (all.length < 2) return { error: "Für dieses Spiel stehen noch nicht alle Teilnehmer fest." };
  const racing = all.filter((id) => !flags[id]);
  const placed = [...new Set(order)].filter((id) => racing.includes(id));
  const missing = racing.length - placed.length;
  if (missing > 0) return { error: `Bitte alle in Zielreihenfolge antippen – ${missing === 1 ? "einer fehlt" : `${missing} fehlen`} noch.` };
  const results = placed.map((id, index) => ({ registration_id: id, rank: index + 1 }));
  return { results: [...results, ...flagTail(all, flags, results.length + 1)] };
}

/** Durchgang mit Punkten je Fahrer (Plus/Minus oder eintippen). Gleichstand nur, wo er erlaubt ist. */
export function pointsResults({ all = [], points = {}, flags = {}, mode = "higher_score", allowsDraw = false, names = {} } = {}) {
  if (all.length < 2) return { error: "Für dieses Spiel stehen noch nicht alle Teilnehmer fest." };
  const racing = all.filter((id) => !flags[id]);
  const value = (id) => Number(points[id] || 0);
  const sorted = [...racing].sort((left, right) => (mode === "lower_score" ? value(left) - value(right) : value(right) - value(left)));
  if (!allowsDraw) {
    const tie = sorted.findIndex((id, index) => index > 0 && value(id) === value(sorted[index - 1]));
    if (tie > 0) {
      return { error: `Gleich viele Punkte bei ${names[sorted[tie - 1]] || "zwei Fahrern"} und ${names[sorted[tie]] || "einem anderen"} – bitte prüfen oder die Reihenfolge antippen.` };
    }
  }
  const results = [];
  sorted.forEach((id, index) => {
    const previous = results[index - 1];
    const rank = previous && previous.score === value(id) ? previous.rank : index + 1;
    results.push({ registration_id: id, rank, score: value(id) });
  });
  return { results: [...results, ...flagTail(all, flags, results.length + 1)] };
}

function joinNames(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function valueText(row) {
  if (row?.score === undefined || row?.score === null) return null;
  const value = Number(row.score);
  return Number.isInteger(value) ? String(value) : String(value).replace(".", ",");
}

/**
 * Der Satz vor dem Speichern: „NeonFalke gewinnt 2:1 – weiter ins Halbfinale“, „Weiter: KartKönigin und NeonFalke“.
 * `entry`: die Beschreibung des Spiels vom Server (participants, advance), `results`: was gesendet wird.
 */
export function resultSentence(entry, results = []) {
  const names = Object.fromEntries((entry?.participants || []).map((row) => [row.registration_id, row.name || "Teilnehmer"]));
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

/** Aus einem gespeicherten Ergebnis den Anfangszustand der Eingabe (zum Korrigieren). */
export function initialState(entry) {
  const sides = (entry?.participants || []).map((row) => row.registration_id);
  const byId = Object.fromEntries((entry?.result || []).map((row) => [row.registration_id, row]));
  const flags = {};
  const scores = {};
  for (const id of sides) {
    const row = byId[id];
    if (row?.forfeit) flags[id] = "no_show";
    else if (row?.dnf) flags[id] = "gave_up";
    scores[id] = row?.score ?? row?.points ?? 0;
  }
  const order = [...(entry?.result || [])].filter((row) => !row.forfeit && !row.dnf).sort((a, b) => Number(a.rank) - Number(b.rank)).map((row) => row.registration_id);
  const winner = (entry?.result || []).find((row) => Number(row.rank) === 1 && !row.forfeit && !row.dnf)?.registration_id || "";
  return { sides, flags, scores, order, winner, games: [] };
}

/** Die Ergebnisse aus dem Zustand der Eingabe - je nach Art. */
export function resultsFor(entry, kind, state) {
  const sides = (entry?.participants || []).map((row) => row.registration_id);
  const names = Object.fromEntries((entry?.participants || []).map((row) => [row.registration_id, row.name]));
  const common = { flags: state.flags || {} };
  if (kind === "score") return scoreResults({ sides, scores: state.scores || {}, mode: entry.ranking_mode, allowsDraw: Boolean(entry.allows_draw), ...common });
  if (kind === "bestof") return bestOfResults({ sides, games: state.games || [], bestOf: entry.best_of, ...common });
  if (kind === "winner") return winnerResults({ sides, winner: state.winner, ...common });
  if (kind === "points") return pointsResults({ all: sides, points: state.scores || {}, mode: entry.ranking_mode, allowsDraw: Boolean(entry.allows_draw), names, ...common });
  return orderResults({ all: sides, order: state.order || [], ...common });
}
