// Champion-Moment (#1119): wer das Turnier gewonnen hat und sein Weg durch den Baum - Spiel für Spiel zurück bis zum
// Start, auch über das Loser Bracket. Der Weg folgt der Herkunft des Platzes, auf dem der Sieger im jeweiligen Spiel
// stand („W:C:1“ → er kam aus C, „L:C:1“ → er fiel in C ins Loser Bracket). Mit mehreren Phasen zählt nur die letzte.
import { normalizeSource } from "@/lib/slotSource";
import { buildPodiumMap, finalMatchOf, isCompleted } from "@/lib/bracketPodium";
import { rankingOf } from "@/lib/tvTravel";

/**
 * Der Sieger und sein Weg - oder `null`, solange das Finale nicht entschieden ist. `path` sind die Spiele des Siegers vom
 * ersten bis zum Finale, `segments` die Strecken dazwischen (`from` → `to`), `podium` Platz 1 bis 3.
 */
export function championOf(matches = [], stages = []) {
  const final = finalMatchOf(matches, stages);
  if (!final || !isCompleted(final)) return null;
  const winner = rankingOf(final).find((row) => Number(row.rank) === 1);
  if (!winner) return null;
  const winnerId = winner.registration_id;
  const stage = final.stage_id || "";
  const byKey = new Map();
  for (const match of matches) {
    if ((match.stage_id || "") === stage && match.match_key) byKey.set(match.match_key, match);
  }
  const path = [final];
  for (let current = final; path.length < 64;) {
    const slot = (current.slots || []).find((entry) => entry?.registration_id === winnerId);
    const source = normalizeSource(slot?.source);
    if (source?.type !== "rank") break;
    const previous = byKey.get(source.match_key);
    if (!previous || path.includes(previous)) break;
    path.unshift(previous);
    current = previous;
  }
  const segments = path.slice(1).map((match, index) => ({ from: path[index].id, to: match.id }));
  const podiumMap = buildPodiumMap(matches, stages);
  const podium = [1, 2, 3]
    .map((rank) => ({ rank, registrationId: [...podiumMap.entries()].find(([, value]) => value === rank)?.[0] || null }))
    .filter((entry) => entry.registrationId);
  return {
    winnerId,
    finalMatchId: final.id,
    score: winner.score ?? winner.points ?? null,
    path: path.map((match) => match.id),
    segments,
    podium,
    viaLoser: path.some((match) => ["lb", "loser"].includes(String(match.section || "").toLowerCase())),
  };
}

/** Ein Schlüssel für „derselbe Sieger im selben Finale“ - damit der Moment genau einmal kommt. */
export function championKey(champion) {
  return champion ? `${champion.finalMatchId}:${champion.winnerId}` : "";
}
