// Seite Team-Liga (#1747): was die Serienseite aus `team_league` von /api/reference-series/public/<spur>/<saison>
// liest. Der Server liefert alles gespeichert (Tabelle, Spiele aus eigener Sicht, Einsätze, Liga-Weg); hier wird nur
// beschriftet und für die Rangliste der Turniere (StandingsTable) umgeformt. Punkte und Vorrang stehen in den Regeln
// der Serie - nichts davon ist hier fest verdrahtet.
import { formatNumber } from "@/lib/standingsTable";

// Kurz wie in der Tabelle der Turniere: S, U, N.
export const OUTCOMES = {
  win: { letter: "S", word: "Sieg" },
  draw: { letter: "U", word: "Unentschieden" },
  loss: { letter: "N", word: "Niederlage" },
};

const TABLE_TIEBREAK_WORDS = {
  score_diff: "bessere Map-Differenz",
  score_for: "mehr gewonnene Maps",
  wins: "mehr Siege",
};

/** „Sieg 3 · Unentschieden 1 · Niederlage 0“ aus den Regeln der Serie. */
export function matchPointsLabel(rules) {
  const points = rules?.match_points;
  if (!points) return "";
  return ["win", "draw", "loss"].map((key) => `${OUTCOMES[key].word} ${formatNumber(points[key])}`).join(" · ");
}

/** Vorrang bei Punktgleichheit, in Worten. */
export function tableTiebreakLabel(rules) {
  const words = (rules?.table_tiebreakers || []).map((name) => TABLE_TIEBREAK_WORDS[name]).filter(Boolean);
  return words.length ? words.join(", dann ") : "Gleichstand teilt den Platz";
}

/** Zeilen für StandingsTable: Schlüssel, Name und „eigenes Team“ in deren Feldern. */
export function tableRows(table) {
  return (table?.rows || []).map((row) => ({
    ...row, registration_id: row.key, display_name: row.team, is_mine: !!row.own, form: row.form || [],
  }));
}

/** Spieltage ohne abgesagte, davon gespielt, und der nächste offene Termin. */
export function matchdayProgress(matchdays) {
  const list = Array.isArray(matchdays) ? matchdays : [];
  const live = list.filter((day) => day.round?.state !== "cancelled");
  const next = live.find((day) => !day.match && ["planned", "today", "postponed"].includes(day.round?.state));
  return {
    total: live.length,
    played: live.filter((day) => day.match).length,
    cancelled: list.length - live.length,
    next: next ? next.round : null,
  };
}

/** Anteil der eigenen Map-Punkte (0 bis 1) für den kleinen Balken; ohne Punkte genau die Mitte. */
export function mapShare(map) {
  const own = Number(map?.score_for) || 0;
  const total = own + (Number(map?.score_against) || 0);
  return total > 0 ? own / total : 0.5;
}

/** Platz nach jedem Spieltag mit der Richtung gegenüber dem davor (`null` beim ersten). */
export function rankTrend(history) {
  return (history || []).map((item, index, list) => {
    if (index === 0) return { ...item, direction: null };
    const before = list[index - 1].rank;
    const direction = item.rank < before ? "up" : item.rank > before ? "down" : "same";
    return { ...item, direction };
  });
}

// ---------------------------------------------------------------- #1931: Bilanz, Maps, Kader

/** Differenz mit Vorzeichen: „+9“, „−4“ (echtes Minus), „±0“. */
function signed(value) {
  const number = Number(value) || 0;
  if (number > 0) return `+${formatNumber(number)}`;
  if (number < 0) return `−${formatNumber(-number)}`;
  return "±0";
}

/**
 * Bilanz eines eigenen Teams für die Anzeige: S/U/N, Maps (Ergebnis der Spiele) und Runden (Summe der Map-Ergebnisse) mit
 * Differenz. Runden gibt es nur aus Spielen mit Maps - `roundsPartial`, wenn nicht alle Spiele Maps haben.
 */
export function recordSummary(item) {
  const rounds = Number(item?.rounds_matches) > 0;
  return {
    team: item?.team, played: item?.played || 0, won: item?.won || 0, drawn: item?.drawn || 0, lost: item?.lost || 0,
    points: item?.points ?? 0,
    maps: `${formatNumber(item?.maps_for || 0)}:${formatNumber(item?.maps_against || 0)}`,
    mapsDiff: signed((item?.maps_for || 0) - (item?.maps_against || 0)),
    rounds: rounds ? `${formatNumber(item.rounds_for || 0)}:${formatNumber(item.rounds_against || 0)}` : "",
    roundsDiff: rounds ? signed((item.rounds_for || 0) - (item.rounds_against || 0)) : "",
    roundsPartial: rounds && Number(item.rounds_matches) < Number(item.played || 0),
  };
}

/** Wer eine Map gewählt hat, aus eigener Sicht. */
export const PICK_LABELS = { own: "Unsere Wahl", opponent: "Wahl Gegner", decider: "Decider" };
const BAN_SIDES = { own: "wir", opponent: "Gegner" };

/** Banns in einer Zeile: „Karte Ost (wir) · Karte Hafen (Gegner)“. */
export function banText(bans) {
  return (bans || []).map((ban) => (BAN_SIDES[ban.by] ? `${ban.name} (${BAN_SIDES[ban.by]})` : ban.name)).join(" · ");
}

/** Ein Spieler an einem Spieltag: gespielt, Ersatz (im Kader, nicht aufgestellt) oder nichts. */
export function cellState(player, roundId) {
  if ((player?.round_ids || []).includes(roundId)) return "played";
  if ((player?.bench_round_ids || []).includes(roundId)) return "bench";
  return "";
}

/** Einsätze kurz: „5 von 7“ - ohne Zahl der Spiele nur die Einsätze. */
export function appearanceText(player) {
  const played = Number(player?.appearances) || 0;
  return Number(player?.of) > 0 ? `${played} von ${player.of}` : String(played);
}

/**
 * Der Kader in Gruppen: bei mehreren eigenen Teams je Team (in der Reihenfolge der Saison), sonst eine Gruppe ohne
 * Überschrift; Gäste immer zuletzt - sie zählen nicht in die Vereinsstatistik.
 */
export function squadGroups(lineup, ownTeams = []) {
  const players = lineup?.players || [];
  const members = players.filter((player) => !player.guest);
  const guests = players.filter((player) => player.guest);
  const groups = [];
  if ((ownTeams || []).length > 1) {
    const teams = [...ownTeams, ...new Set(members.map((player) => player.team).filter((team) => team && !ownTeams.includes(team)))];
    for (const team of teams) {
      const list = members.filter((player) => player.team === team);
      if (list.length) groups.push({ key: `team-${team}`, label: team, players: list });
    }
    const rest = members.filter((player) => !teams.includes(player.team));
    if (rest.length) groups.push({ key: "members", label: "Ohne Team", players: rest });
  } else if (members.length) {
    groups.push({ key: "members", label: null, players: members });
  }
  if (guests.length) groups.push({ key: "guests", label: "Gäste", players: guests });
  return groups;
}

/** „Platz 2 von 8“ für den Liga-Weg. */
export function pathRankLabel(season) {
  if (!season?.rank) return "Noch keine Tabelle";
  return season.teams ? `Platz ${season.rank} von ${season.teams}` : `Platz ${season.rank}`;
}
