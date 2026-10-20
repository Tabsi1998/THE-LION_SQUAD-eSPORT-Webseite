// Gesamtwertung der Serienseite (#1745): was die Tabelle aus /api/reference-series/public/<spur>/<saison> liest. Der
// Server rechnet alles und speichert es (Punkte, gezählte und gestrichene Runden, Rang, Platz davor); hier wird nur
// gefiltert, beschriftet und die Finalgrenze gesetzt. Fremde Namen sind reiner Text - nur Vereinsmitglieder haben
// einen Profil-Link; ein ausgeblendeter Name kommt gar nicht erst vom Server.
import { formatNumber } from "@/lib/standingsTable";

export const HIDDEN_NAME = "Name ausgeblendet";
export const MOBILE_TOP = 10;

const TIEBREAK_WORDS = {
  wins: "mehr Siege",
  podiums: "mehr Podestplätze",
  countback: "bessere Platzierungen (mehr Siege, dann mehr zweite Plätze …)",
  best_place: "beste Einzelplatzierung",
  latest_result: "besseres Ergebnis in der letzten Runde",
};

export function nameOf(row) {
  return row?.name_hidden || !row?.name ? HIDDEN_NAME : row.name;
}

/** Zeilen der Tabelle, mit „Nur Vereinsspieler“ gefiltert; der Rang bleibt der der ganzen Wertung. */
export function visibleRows(rows, { clubOnly = false } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  return clubOnly ? list.filter((row) => row.club_member) : list;
}

/** Schlüssel der Zeile, nach der die Linie „Finalgrenze“ steht: die letzte gezeigte Zeile mit Rang ≤ N, auf die noch
 * eine Zeile mit Rang > N folgt. Sonst `null` (keine Grenze, oder alle gezeigten liegen auf einer Seite). */
export function cutlineAfter(rows, topN) {
  const limit = Number(topN);
  if (!Number.isInteger(limit) || limit < 1) return null;
  const list = Array.isArray(rows) ? rows : [];
  for (let index = 0; index < list.length - 1; index += 1) {
    if (list[index].rank <= limit && list[index + 1].rank > limit) return list[index].key;
  }
  return null;
}

/** Am Handy: die ersten zehn und dazu jedes Vereinsmitglied weiter hinten - die volle Tabelle lässt sich aufklappen. */
export function mobileRows(rows, { expanded = false, top = MOBILE_TOP } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  if (expanded) return list;
  return list.filter((row, index) => index < top || row.club_member);
}

/** Das Ergebnis einer Zeile in einer Runde (oder `null`, wenn sie dort nicht dabei war). */
export function resultIn(row, roundId) {
  return (row?.results || []).find((item) => item.round_id === roundId) || null;
}

/** Beschriftung einer Ergebniszelle: Punkte, für Screenreader mit Platz und „gestrichen“. */
export function resultLabel(result, roundName) {
  if (!result) return `${roundName}: nicht dabei`;
  const parts = [`${roundName}: ${formatNumber(result.points)} ${Number(result.points) === 1 ? "Punkt" : "Punkte"}`];
  if (result.place) parts.push(`Platz ${result.place}`);
  if (result.dropped) parts.push("gestrichen");
  return parts.join(", ");
}

/** Die Wertungsrunden als Spalten: ohne Finale und ohne Runden außerhalb der Wertung, abgesagte mit Vermerk. */
export function roundColumns(rounds) {
  return (rounds || []).filter((round) => round.kind !== "final" && round.counts !== false);
}

/** Punkteschlüssel in einer Zeile: „25 · 18 · 15 …“ oder „laut Veranstalter“. */
export function schemeLabel(rules) {
  if (rules?.points_mode !== "scheme") return "Punkte laut Veranstalter";
  const scheme = (rules.points_by_place || []).map(formatNumber);
  return scheme.length ? `Platz 1 bis ${scheme.length}: ${scheme.join(" · ")}` : "Keine Punkte je Platz";
}

/** Was zählt: alle Runden, die besten N oder alle bis auf N Streichergebnisse. */
export function countLabel(rules) {
  const n = Number(rules?.count_n) || 0;
  if (rules?.count_mode === "best_n") return `Die besten ${n} Ergebnisse zählen`;
  if (rules?.count_mode === "drop_n" && n > 0) return n === 1 ? "Ein Streichergebnis" : `${n} Streichergebnisse`;
  return "Alle Runden zählen";
}

/** Vorrang bei Gleichstand, in Worten. */
export function tiebreakLabel(rules) {
  const words = (rules?.tiebreakers || []).map((name) => TIEBREAK_WORDS[name]).filter(Boolean);
  return words.length ? words.join(", dann ") : "Gleichstand teilt den Platz";
}

/** Hinweis an einer Zeile, die bei gleichen Punkten wegen eines Kriteriums hinter der darüber steht. */
export function tiebreakHint(name) {
  return TIEBREAK_WORDS[name] ? `Gleich viele Punkte – dahinter wegen: ${TIEBREAK_WORDS[name]}` : "";
}
