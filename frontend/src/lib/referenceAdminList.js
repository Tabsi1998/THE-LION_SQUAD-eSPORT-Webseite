// Referenzliste der Verwaltung (#2130): bis zu 1000 Einträge - Suche, Filter nach Spiel, Jahr und Status, Seiten.
// Gefiltert wird im Browser: die Liste ist da, und Bearbeiten und Prüfung brauchen sie ohnehin ganz.
import { normalizeSearch } from "@/lib/adminListTools";
import { yearOf } from "@/lib/referencesOverview";

export const REFERENCE_PAGE_SIZE = 25;

// „Archiviert“ ist der Schalter, nicht der Status (#2130).
export const REFERENCE_STATUS_FILTERS = Object.freeze([
  ["active", "Laufend"],
  ["planned", "Geplant"],
  ["completed", "Abgeschlossen"],
  ["archived", "Archiviert"],
]);

export function gameNameOf(item) {
  return item?.game?.display_name || item?.game?.name || item?.game_name || "";
}

function gameKeyOf(item) {
  return item?.game_id || (item?.game_name ? `name:${item.game_name}` : "");
}

function statusKeyOf(item) {
  return item?.is_active === false ? "archived" : item?.status || "completed";
}

function searchText(item) {
  const entries = item?.entries || [];
  return normalizeSearch([
    item?.display_title, item?.title, item?.organizer, item?.league, item?.season, item?.format, item?.location, gameNameOf(item),
    ...entries.map((entry) => entry?.team_name),
    ...entries.flatMap((entry) => [...(entry?.lineup || []), ...(entry?.lineup_members || []).map((member) => member?.display_name)]),
  ].filter(Boolean).join(" "));
}

/** Was in den Filtern steht - nur, was es in der Liste gibt: Spiele nach Name, Jahre von neu nach alt. */
export function referenceFilterOptions(items) {
  const games = new Map();
  const years = new Set();
  (items || []).forEach((item) => {
    const key = gameKeyOf(item);
    if (key && !games.has(key)) games.set(key, gameNameOf(item) || "Unbekanntes Spiel");
    const year = yearOf(item);
    if (year) years.add(String(year));
  });
  return {
    games: [...games.entries()].sort((a, b) => a[1].localeCompare(b[1], "de-AT")),
    years: [...years].sort((a, b) => b.localeCompare(a)),
  };
}

export function filterReferences(items, { query = "", game = "", year = "", status = "" } = {}) {
  const needle = normalizeSearch(query);
  return (items || []).filter((item) => {
    if (game && gameKeyOf(item) !== game) return false;
    if (year && String(yearOf(item) || "") !== year) return false;
    if (status && statusKeyOf(item) !== status) return false;
    return !needle || searchText(item).includes(needle);
  });
}

/** Eine Seite der Liste; eine zu große Seitenzahl (Filter hat die Liste verkürzt) landet auf der letzten. */
export function pageOf(items, page, size = REFERENCE_PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil((items || []).length / size));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  return { rows: (items || []).slice((current - 1) * size, current * size), page: current, pages };
}
