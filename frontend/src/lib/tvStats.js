// Statistik-Häppchen (#1124): ab und zu ein paar Zahlen, die auflockern - höchstens drei Kacheln, nur mit echten
// Zahlen. Freilos, abgesagte und nicht gespielte Spiele (kampflos, nicht erschienen) zählen nicht. Bei Gleichstand nennt
// eine Kachel alle Gleichen - sind es zu viele, fällt sie weg. Vor dem ersten Ergebnis gibt es die Folie nicht.
import { isMatchDone } from "@/lib/slotSource";
import { matchName } from "@/lib/tvLive";

const NOT_PLAYED = new Set(["bye", "cancelled", "forfeit", "no_show", "walkover"]);
const MAX_NAMED = 3;

function isBye(match) {
  return (match?.slots || []).some((slot) => {
    const status = String(slot?.status || "").toLowerCase();
    return status === "bye" || status === "walkover" || slot?.source?.type === "bye";
  });
}

/** Zählt das Spiel überhaupt (kein Freilos, nicht abgesagt, nicht kampflos)? */
export function countsAsGame(match) {
  return Boolean(match?.id) && !NOT_PLAYED.has(String(match.status || "").toLowerCase()) && !isBye(match);
}

function ranking(match) {
  return (match?.results || [])
    .filter((row) => row?.registration_id && Number.isFinite(Number(row.rank)))
    .sort((a, b) => Number(a.rank) - Number(b.rank));
}

/** Gespielt: entschieden, mit Ergebnis für mindestens zwei Spieler. */
export function wasPlayed(match) {
  return countsAsGame(match) && isMatchDone(match) && new Set(ranking(match).map((row) => row.registration_id)).size >= 2;
}

function isHeat(match) {
  return String(match?.match_type || "duel") !== "duel" || (match?.slots || []).length > 2;
}

function namesText(names) {
  if (names.length <= 1) return names[0] || "";
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

function scoreOf(row) {
  const value = row?.score ?? row?.points;
  return value === null || value === undefined || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);
}

/**
 * Bis zu drei Kacheln: „Spiele gespielt“ (mit Ring), „Meiste Siege“, „Knappster Zieleinlauf“. `nameOf(id)` liefert
 * den Namen einer Anmeldung. Leer, solange noch kein Spiel gespielt ist.
 */
export function statsTiles(matches = [], nameOf = () => "") {
  const games = (matches || []).filter(countsAsGame);
  const played = games.filter(wasPlayed);
  if (!played.length) return [];
  const tiles = [{ kind: "played", played: played.length, total: games.length }];

  // Meiste Siege: Platz 1 im Duell oder im Durchgang.
  const wins = new Map();
  for (const match of played) {
    const [winner] = ranking(match);
    const id = match.winner_id && !isHeat(match) ? match.winner_id : winner?.registration_id;
    if (id) wins.set(id, (wins.get(id) || 0) + 1);
  }
  const most = Math.max(0, ...wins.values());
  const leaderIds = [...wins.entries()].filter(([, count]) => count === most).map(([id]) => id).filter((id) => nameOf(id));
  if (most > 0 && leaderIds.length && leaderIds.length <= MAX_NAMED) {
    const heats = played.every(isHeat);
    const duels = played.every((match) => !isHeat(match));
    const noun = heats ? (most === 1 ? "Durchgang" : "Durchgänge") : duels ? (most === 1 ? "Spiel" : "Spiele") : (most === 1 ? "Sieg" : "Siege");
    const verb = heats || duels ? " gewonnen" : "";
    tiles.push({ kind: "wins", ids: leaderIds, names: leaderIds.map(nameOf), wins: most, text: `${leaderIds.length > 1 ? "je " : ""}${most} ${noun}${verb}` });
  }

  // Knappster Zieleinlauf: der kleinste Abstand zwischen zwei Plätzen nacheinander.
  const gaps = [];
  for (const match of played) {
    const rows = ranking(match);
    for (let index = 0; index + 1 < rows.length; index += 1) {
      const [a, b] = [scoreOf(rows[index]), scoreOf(rows[index + 1])];
      if (a === null || b === null) continue;
      gaps.push({ gap: Math.abs(a - b), match, ids: [rows[index].registration_id, rows[index + 1].registration_id] });
    }
  }
  if (gaps.length) {
    const smallest = Math.min(...gaps.map((entry) => entry.gap));
    const closest = gaps.filter((entry) => entry.gap === smallest);
    const matchesWithGap = [...new Map(closest.map((entry) => [entry.match.id, entry.match])).values()];
    const unit = smallest === 1 ? "Punkt" : "Punkte";
    const big = smallest === 0 ? "Punktgleich" : `${smallest} ${unit}`;
    if (closest.length === 1) {
      const [only] = closest;
      const names = only.ids.map(nameOf).filter(Boolean);
      if (names.length === 2) {
        const text = smallest === 0
          ? `${namesText(names)} in ${matchName(only.match)} – entschieden hat die Wertung.`
          : `zwischen ${namesText(names)} in ${matchName(only.match)}.`;
        tiles.push({ kind: "closest", gap: smallest, big, text });
      }
    } else if (matchesWithGap.length <= MAX_NAMED) {
      tiles.push({ kind: "closest", gap: smallest, big, text: `Abstand in ${namesText(matchesWithGap.map(matchName))}.` });
    }
  }
  return tiles;
}
