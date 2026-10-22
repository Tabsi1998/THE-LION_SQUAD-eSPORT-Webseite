// Gesamtwertung der Serienseite (#1745): was die Tabelle aus /api/reference-series/public/<spur>/<saison> liest. Der
// Server rechnet alles und speichert es (Punkte, gezählte und gestrichene Runden, Rang, Platz davor); hier wird nur
// gefiltert, beschriftet und die Finalgrenze gesetzt. Fremde Namen sind reiner Text - nur Vereinsmitglieder haben
// einen Profil-Link; ein ausgeblendeter Name kommt gar nicht erst vom Server.
import { formatNumber } from "@/lib/standingsTable";

export const HIDDEN_NAME = "Name ausgeblendet";
export const MOBILE_TOP = 10;

const TIEBREAK_WORDS = {
  wins: "mehr Siege",
  // #1961: N steht in den Regeln (`tiebreak_top_n`).
  top_n: "mehr Plätze unter den besten N",
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

function tiebreakWord(name, topN) {
  const word = TIEBREAK_WORDS[name];
  return word && name === "top_n" ? word.replace("N", String(Number(topN) || 4)) : word;
}

/** Vorrang bei Gleichstand, in Worten. */
export function tiebreakLabel(rules) {
  const words = (rules?.tiebreakers || []).map((name) => tiebreakWord(name, rules?.tiebreak_top_n)).filter(Boolean);
  return words.length ? words.join(", dann ") : "Gleichstand teilt den Platz";
}

/** Hinweis an einer Zeile, die bei gleichen Punkten wegen eines Kriteriums hinter der darüber steht. */
export function tiebreakHint(name, topN) {
  const word = tiebreakWord(name, topN);
  return word ? `Gleich viele Punkte – dahinter wegen: ${word}` : "";
}

/** Turniertag (#1961): „5 Runden je Turniertag, Platz 1 bis 8: 8 · 7 · …“ - leer ohne Runden. */
export function dayRoundsLabel(rules) {
  const count = Number(rules?.day_rounds?.count) || 0;
  if (!count) return "";
  const scheme = (rules.day_rounds.points_by_place || []).map(formatNumber);
  const runden = count === 1 ? "1 Runde" : `${count} Runden`;
  return `${runden} je Turniertag${scheme.length ? `, Platz 1 bis ${scheme.length}: ${scheme.join(" · ")}` : ""} – die Summe ergibt den Tagesplatz`;
}

/** Double Up (#2015) in Worten - nur bei Saisons mit Turniertagen (dort gibt es Double Up), sonst leer. */
export function doubleUpLabel(rules) {
  if (!(Number(rules?.day_rounds?.count) > 0)) return "";
  return rules?.double_up_points === "team_place"
    ? "Team-Platz k zählt wie Platz k – für beide Spieler"
    : "Team-Platz k zählt wie Einzelplatz 2k−1 (Team 2 → Platz 3) – für beide Spieler";
}

/** Sonderboni (#1961): „Bingo +3 · Joker +2 – zählen zusätzlich, nie gestrichen“ - leer ohne. */
export function bonusRulesLabel(rules) {
  const bonuses = rules?.custom_bonuses || [];
  if (!bonuses.length) return "";
  return `${bonuses.map((bonus) => `${bonus.label} +${formatNumber(bonus.points)}`).join(" · ")} – zählen zusätzlich, nie gestrichen`;
}
