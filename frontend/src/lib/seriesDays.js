// Turniertage auf der Serienseite (#1961): Tagesansicht R1…Rn mit Summe, Lobby-Ansicht je Runde und das Spieler-Detail
// mit Tages- und Saisonpunkten. Alles kommt gespeichert vom Server (Ergebnisse der Gesamtwertung mit `day_rounds`,
// `day_points`, `partner`, `bonus`) - hier wird nur gefiltert, sortiert und beschriftet.
import { formatNumber } from "@/lib/standingsTable";

const hasDay = (result) => Boolean(result && ((result.day_rounds || []).length || (result.day_points !== undefined && result.day_points !== null)));

/** Die Termine mit Turniertag (Runden oder Tagessumme), in Kalender-Reihenfolge. */
export function dayRounds(rounds, rows) {
  const withDay = new Set((rows || []).flatMap((row) => (row.results || []).filter(hasDay).map((result) => result.round_id)));
  return (rounds || []).filter((round) => withDay.has(round.id));
}

/** Platz einer Runde in der Lobby: eingetragen oder - eindeutig - aus den Punkten und dem Rundenschema. */
export function roundPlace(entry, scheme = []) {
  if (!entry) return null;
  if (entry.place) return entry.place;
  const points = Number(entry.points);
  const hits = scheme.map((value, index) => (Number(value) === points ? index + 1 : null)).filter(Boolean);
  return points > 0 && hits.length === 1 ? hits[0] : null;
}

/** Farbe eines Platzes: Gold, Silber, Bronze, Top 4 grün - sonst keine. */
export function placeTone(place) {
  if (place === 1) return "gold";
  if (place === 2) return "silver";
  if (place === 3) return "bronze";
  if (place && place <= 4) return "top";
  return null;
}

/** Die Zeilen eines Turniertags: je Person ihr Ergebnis dort, nach Tagesplatz (ohne Platz am Ende), dann Rang gesamt. */
export function dayTable(rows, roundId) {
  const out = [];
  for (const row of rows || []) {
    const result = (row.results || []).find((item) => item.round_id === roundId);
    if (!result) continue;
    out.push({ ...result, key: row.key, name: row.name, name_hidden: row.name_hidden, club_member: row.club_member, profile_slug: row.profile_slug, rank: row.rank });
  }
  return out.sort((left, right) => (left.place ?? Infinity) - (right.place ?? Infinity) || (left.rank ?? Infinity) - (right.rank ?? Infinity));
}

/** Wie viele Runden ein Turniertag hatte (die längste Zeile). */
export function roundsOfDay(table) {
  return Math.max(0, ...(table || []).map((item) => (item.day_rounds || []).length));
}

/** Double Up erkennt man am Partner. */
export function isDoubleUp(table) {
  return (table || []).some((item) => item.partner);
}

/** Double Up (#2015): was Platz und Punkte im Tag heißen - „Platz = Team-Platz, Punkte wie Einzelplatz 2k−1“. */
export function doubleUpDayText(rules) {
  return rules?.double_up_points === "team_place"
    ? "Platz = Team-Platz, Punkte nach Team-Platz"
    : "Platz = Team-Platz, Punkte wie Einzelplatz 2k−1";
}

/** Lobby-Ansicht einer Runde: je Lobby die Spieler nach Platz - `null`, wenn keine Lobby eingetragen ist. */
export function lobbies(table, index, scheme = []) {
  const groups = new Map();
  for (const item of table || []) {
    const entry = item.day_rounds?.[index];
    if (!entry || !entry.lobby) continue;
    if (!groups.has(entry.lobby)) groups.set(entry.lobby, []);
    // Im Double Up gelten für ein Team andere Punkte - dort zählt nur ein eingetragener Platz.
    groups.get(entry.lobby).push({ item, entry, place: item.partner ? entry.place || null : roundPlace(entry, scheme) });
  }
  if (!groups.size) return null;
  return [...groups.entries()]
    .map(([lobby, members]) => ({ lobby, members: members.sort((left, right) => (left.place ?? Infinity) - (right.place ?? Infinity) || (right.entry.points ?? 0) - (left.entry.points ?? 0)) }))
    .sort((left, right) => left.lobby.localeCompare(right.lobby, "de", { numeric: true }));
}

/** Hat irgendeine Runde eines Turniertags eine Lobby? */
export function hasLobbies(table) {
  return (table || []).some((item) => (item.day_rounds || []).some((entry) => entry?.lobby));
}

/** Namen der Sonderboni einer Zeile: „Bingo +3“. */
export function bonusLabels(keys, bonuses = []) {
  return (keys || []).map((key) => {
    const bonus = bonuses.find((item) => item.key === key);
    return bonus ? `${bonus.label} +${formatNumber(bonus.points)}` : key;
  });
}

/** Spieler-Detail: je Turniertag Platz, Tagessumme, Runden, Saisonpunkte (gestrichen?), Bonus - dazu Summen. */
export function playerDays(row, rounds) {
  const days = (rounds || []).map((round) => ({ round, result: (row?.results || []).find((item) => item.round_id === round.id) || null }));
  const played = days.filter((day) => day.result);
  const topN = (n) => played.filter((day) => day.result.place && day.result.place <= n).length;
  return {
    days,
    played: played.length,
    wins: played.filter((day) => day.result.place === 1).length,
    topN,
    dayPoints: played.reduce((sum, day) => sum + (Number(day.result.day_points) || 0), 0),
  };
}
