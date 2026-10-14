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
  const mine = flatRows(standings).find((row) => row.is_mine);
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

/** Treppchen: Platz 2 links, 1 in der Mitte, 3 rechts; gleiche Plätze stehen nebeneinander, fehlende bleiben leer. */
export function podiumPlaces(standings) {
  const rows = flatRows(standings).filter((row) => Number(row.rank) >= 1 && Number(row.rank) <= 3);
  if (!rows.length) return [];
  return [2, 1, 3].map((rank) => ({ rank, ...PLACEMENT_LOOKS[rank], rows: rows.filter((row) => Number(row.rank) === rank) }));
}
