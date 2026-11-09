// Sieger-Moment und Podest (#1180, #1339): wer nach dem Ende einen Moment bekommt und wie das Treppchen steht.
// Reine Funktionen - Rangliste und eigene Zeile (`is_mine`) kommen vom Server, gemerkt wird je Browser.

// Der Endstand gilt erst mit „Ergebnisse veröffentlicht“ (Statusvertrag); „Beendet“ heißt nur: die Spiele sind durch.
const CONFIRMED = new Set(["results_published", "archived"]);
const STORAGE_PREFIX = "tls-placement-moment:";

// Metall nur an Kante und Ziffer (#1339) - die Werte stehen als Farb-Rollen in styles/system.css.
export const PLACEMENT_LOOKS = {
  1: { metal: "gold", title: "Champion", label: "Platz 1" },
  2: { metal: "silver", title: "Zweiter Platz", label: "Platz 2" },
  3: { metal: "bronze", title: "Dritter Platz", label: "Platz 3" },
};

function flatRows(standings) {
  const list = Array.isArray(standings) ? standings : [];
  // Gruppentabellen ([{group, standings}]) vergeben keinen Turnierplatz.
  return list.filter((row) => row && !Array.isArray(row.standings) && row.registration_id);
}

/** Der eigene Platz 1 bis 3 eines Turniers mit veröffentlichten Ergebnissen - oder `null`. */
export function placementFor(tournament, standings) {
  if (!tournament || !CONFIRMED.has(String(tournament.status || ""))) return null;
  // Mehrere eigene Anmeldungen (etwa zwei Teams): der beste eigene Podestplatz zählt, nicht die erste Zeile.
  const mine = flatRows(standings)
    .filter((row) => row.is_mine && PLACEMENT_LOOKS[Number(row.rank)])
    .sort((a, b) => Number(a.rank) - Number(b.rank))[0];
  const rank = Number(mine?.rank);
  const look = PLACEMENT_LOOKS[rank];
  if (!mine || !look) return null;
  return {
    key: `${tournament.id}:${mine.registration_id}`,
    rank,
    ...look,
    registrationId: mine.registration_id,
    name: mine.display_name || "",
    team: !!mine.team_id,
    tournamentId: tournament.id,
    tournamentTitle: tournament.title || "",
    tournamentSlug: tournament.slug || tournament.id,
    tournamentPath: `/tournaments/${tournament.slug || tournament.id}`,
  };
}

function defaultStorage() {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Schon gezeigt? Ohne lesbaren Speicher lieber nie als bei jedem Öffnen. */
export function placementShown(placement, storage = defaultStorage()) {
  if (!placement) return true;
  try {
    if (!storage) return true;
    return storage.getItem(`${STORAGE_PREFIX}${placement.key}`) === "1";
  } catch {
    return true;
  }
}

export function markPlacementShown(placement, storage = defaultStorage()) {
  if (!placement || !storage) return;
  try {
    storage.setItem(`${STORAGE_PREFIX}${placement.key}`, "1");
  } catch {
    // Privates Fenster oder gesperrter Speicher: dann eben nicht gemerkt.
  }
}

/**
 * Treppchen: Platz 2 links, 1 in der Mitte, 3 rechts; gleiche Plätze stehen nebeneinander auf einer Stufe. Ein Platz,
 * den ein Gleichstand überspringt (zwei Erste - kein Zweiter), bekommt keine Stufe; ein Platz, den es schlicht nicht
 * gibt (nur zwei haben gespielt), bleibt als leere Stufe mit „–“ stehen.
 */
/** Gewonnene Spiele einer Zeile - `won` aus der Baum-Rangliste, `wins` aus Altbestand und Rückblick. */
export function podiumWins(row) {
  const wins = Number(row?.won ?? row?.wins);
  return Number.isFinite(wins) ? wins : null;
}

/** „4 Spiele gewonnen“, „1 Spiel gewonnen“, „kein Spiel gewonnen“ - dieselben Worte wie der Server (games_won_text). */
export function gamesWonText(wins) {
  const count = Math.max(0, Math.trunc(Number(wins) || 0));
  if (!count) return "kein Spiel gewonnen";
  return `${count} ${count === 1 ? "Spiel" : "Spiele"} gewonnen`;
}

/**
 * Der Satz unter dem Podest (#2336) - nur im Baum (eine Zeile mit `place_path` bzw. `path`) und nur, wenn die Siege
 * nicht zur Reihenfolge passen: jemand auf einem besseren Platz hat weniger Spiele gewonnen als jemand dahinter. Liga,
 * Gruppen, FFA und Fast Lap haben keinen Weg und bekommen nie einen Satz.
 */
export function podiumRoundNote(rows = []) {
  const tree = (rows || []).filter((row) => row && (row.place_path || row.path) && podiumWins(row) != null && Number(row.rank) >= 1);
  const mismatch = tree.some((better) => tree.some((worse) => Number(better.rank) < Number(worse.rank) && podiumWins(better) < podiumWins(worse)));
  if (!mismatch) return "";
  const double = tree.some((row) => /\b(?:Loser|Grand Final)\b/.test(`${row.reached || ""} ${row.place_path || row.path || ""}`));
  return [
    "Im K.-o. zählt die erreichte Runde, nicht die Zahl der Siege. Ein Freilos zählt nicht als Sieg.",
    double ? "Im Doppel-K.-o. sammelt man in der Verliererrunde oft mehr Siege." : "",
  ].filter(Boolean).join(" ");
}

export function podiumPlaces(standings) {
  const rows = flatRows(standings).filter((row) => Number(row.rank) >= 1 && Number(row.rank) <= 3);
  if (!rows.length) return [];
  const byRank = (rank) => rows.filter((row) => Number(row.rank) === rank);
  const skipped = (rank) => [1, 2].some((above) => above < rank && byRank(above).length && above + byRank(above).length - 1 >= rank);
  return [2, 1, 3]
    .filter((rank) => byRank(rank).length || !skipped(rank))
    .map((rank) => ({ rank, ...PLACEMENT_LOOKS[rank], rows: byRank(rank) }));
}
