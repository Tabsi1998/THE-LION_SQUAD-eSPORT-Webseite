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

/** „Platz 2 von 8“ für den Liga-Weg. */
export function pathRankLabel(season) {
  if (!season?.rank) return "Noch keine Tabelle";
  return season.teams ? `Platz ${season.rank} von ${season.teams}` : `Platz ${season.rank}`;
}
