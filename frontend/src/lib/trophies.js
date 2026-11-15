// Reiter „Trophäen“ (#2425, Nr. 59) an Profil und Team: Turnier-Pokale und Liga-Belohnungen in einer Vitrine, mit Filtern nach Art,
// Spiel, Season bzw. Jahr und Platz. Dazu die bis zu drei Embleme neben dem Namen (Nr. 34c). Reine Logik - Tests und App lesen dieselbe.
import { asInstant, viennaDate } from "@/lib/vienna";

/** Nur der Tag im Vereins-Kalender – die Uhrzeit des Turnierstarts gehört nicht aufs Banner (auch ``AwardBanner``). */
export function awardDay(value) {
  if (!value) return "";
  const date = asInstant(value);
  if (Number.isNaN(date.getTime())) return "";
  return viennaDate(date, { day: "numeric", month: "numeric", year: "numeric", timeZone: "Europe/Vienna" });
}

export const TROPHY_KINDS = [
  ["trophy", "Pokal"],
  ["medal", "Medaille"],
  ["banner", "Banner"],
  ["emblem", "Emblem"],
  ["title", "Titel"],
];
const KIND_LABELS = Object.fromEntries(TROPHY_KINDS);
export const PLACE_FILTERS = [["1", "1. Platz"], ["2", "2. Platz"], ["3", "3. Platz"], ["other", "Weitere Plätze"]];

// Embleme neben dem Namen: Belohnungen der Art „Emblem“ oder „Medaille“, höchstens drei (der Server prüft dasselbe).
export const EMBLEM_LIMIT = 3;
export const EMBLEM_KINDS = new Set(["emblem", "medal"]);

export const ALL = "";
export const NO_FILTER = { kind: ALL, game: ALL, period: ALL, place: ALL };

/** Die Art einer Auszeichnung: bei Liga-Belohnungen die der Vorlage, sonst Pokal (Platz 1–3) bzw. Banner. */
export function trophyKind(award) {
  const kind = award?.reward?.kind || award?.kind;
  return KIND_LABELS[kind] ? kind : "banner";
}

export function kindLabel(award) {
  return KIND_LABELS[trophyKind(award)];
}

export function fitsEmblem(award) {
  return EMBLEM_KINDS.has(trophyKind(award)) && Boolean(award?.reward);
}

function year(value) {
  const day = awardDay(value);
  const match = /(\d{4})$/.exec(day);
  return match ? match[1] : "";
}

/** Season bzw. Jahr: die Season der Liga (bzw. die Saison des Vereins), sonst das Jahr des Wettbewerbs. */
export function periodOf(award) {
  return award?.reward?.art?.season || award?.season?.name || year(award?.date) || "";
}

export function gameOf(award) {
  return award?.game?.name || "";
}

export function placeOf(award) {
  const rank = Number(award?.rank);
  return rank >= 1 && rank <= 3 ? String(rank) : "other";
}

/** Name auf der Karte: die Belohnung, sonst der Wettbewerb. */
export function trophyName(award) {
  return award?.reward?.name || award?.tournament?.title || "Turnier";
}

/** Der Wettbewerb unter dem Namen: bei Belohnungen Liga · Season und Staffel, bei Turnieren Spiel und Teilnehmerfeld. */
export function competitionLine(award) {
  if (award?.reward) {
    const staffel = award.league?.staffel ? `Staffel ${award.league.staffel}` : "";
    return [award.tournament?.title, award.league?.division_label || award.reward.art?.division, staffel].filter(Boolean).join(" · ");
  }
  return [gameOf(award), award?.participants ? `${award.participants} Teilnehmer` : ""].filter(Boolean).join(" · ");
}

/** Wohin die Karte führt: die Seite des Wettbewerbs (Gesamtwertung: die Ligaseite, die der Server nennt). */
export function trophyHref(award) {
  if (award?.url) return award.url;
  const slug = award?.tournament?.slug;
  return slug ? `/tournaments/${encodeURIComponent(slug)}` : null;
}

export function trophyDate(award) {
  return awardDay(award?.date);
}

/** Was die Filter anbieten - nur, was in der Vitrine vorkommt, in fester Reihenfolge. */
export function trophyFacets(awards) {
  const list = Array.isArray(awards) ? awards : [];
  const kinds = new Set(list.map(trophyKind));
  const places = new Set(list.map(placeOf));
  const unique = (values) => [...new Set(values.filter(Boolean))];
  const periods = unique(list.map(periodOf)).sort((a, b) => b.localeCompare(a, "de", { numeric: true }));
  return {
    kinds: TROPHY_KINDS.filter(([key]) => kinds.has(key)),
    games: unique(list.map(gameOf)).sort((a, b) => a.localeCompare(b, "de")),
    periods,
    places: PLACE_FILTERS.filter(([key]) => places.has(key)),
  };
}

export function filterTrophies(awards, filters = NO_FILTER) {
  const list = Array.isArray(awards) ? awards : [];
  return list.filter((award) => (!filters.kind || trophyKind(award) === filters.kind)
    && (!filters.game || gameOf(award) === filters.game)
    && (!filters.period || periodOf(award) === filters.period)
    && (!filters.place || placeOf(award) === filters.place));
}

export function activeFilters(filters = NO_FILTER) {
  return Object.values(filters).filter(Boolean).length;
}

/** Neueste zuerst, am selben Tag der bessere Platz vorn. */
export function sortTrophies(awards) {
  const rank = (award) => (Number(award?.rank) > 0 ? Number(award.rank) : 999);
  return [...(Array.isArray(awards) ? awards : [])].sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || rank(a) - rank(b)
    || String(a.id).localeCompare(String(b.id)));
}

/** Ein Emblem dazu oder weg - in der gewählten Reihenfolge, nie mehr als drei. ``null``: geht nicht (voll). */
export function toggleEmblem(chosen, awardId) {
  const list = (Array.isArray(chosen) ? chosen : []).filter(Boolean);
  if (list.includes(awardId)) return list.filter((id) => id !== awardId);
  if (list.length >= EMBLEM_LIMIT) return null;
  return [...list, awardId];
}
