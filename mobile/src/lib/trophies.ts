import { awardDay } from "./awards";
import type { RewardAward } from "./leagueRewards";

// Reiter „Trophäen“ (#2425, Nr. 59; App: #2173) an Profil und Team: Turnier-Pokale und Liga-Belohnungen in einer Vitrine, mit Filtern
// nach Art, Spiel, Season bzw. Jahr und Platz. Dazu die bis zu drei Embleme neben dem Namen (Nr. 34c). Dieselben Regeln wie im Web
// (frontend/src/lib/trophies.js) - der Server prüft Besitz und Anzahl.

export type TrophyAward = RewardAward & { url?: string | null };
export type TrophyKind = "trophy" | "medal" | "banner" | "emblem" | "title";
export type TrophyFilters = { kind: string; game: string; period: string; place: string };

export const TROPHY_KINDS: Array<[TrophyKind, string]> = [
  ["trophy", "Pokal"],
  ["medal", "Medaille"],
  ["banner", "Banner"],
  ["emblem", "Emblem"],
  ["title", "Titel"],
];
const KIND_LABELS = Object.fromEntries(TROPHY_KINDS) as Record<TrophyKind, string>;
export const PLACE_FILTERS: Array<[string, string]> = [["1", "1. Platz"], ["2", "2. Platz"], ["3", "3. Platz"], ["other", "Weitere Plätze"], ["all", "Alle Teilnehmer"]];
// Belohnung für alle Teilnehmer (Liga): derselbe Text wie `league_reward_rules.place_label` - sie zählt nie als Platz 1 bis 3.
export const ALL_PLACES_LABEL = "Alle Teilnehmer";

// Embleme neben dem Namen: Belohnungen der Art „Emblem“ oder „Medaille“, höchstens drei (der Server prüft dasselbe).
export const EMBLEM_LIMIT = 3;
const EMBLEM_KINDS = new Set<string>(["emblem", "medal"]);

export const ALL = "";
export const NO_FILTER: TrophyFilters = { kind: ALL, game: ALL, period: ALL, place: ALL };

/** Die Art einer Auszeichnung: bei Liga-Belohnungen die der Vorlage, sonst Pokal (Platz 1–3) bzw. Banner. */
export function trophyKind(award?: TrophyAward | null): TrophyKind {
  const kind = String(award?.reward?.kind || award?.kind || "");
  return kind in KIND_LABELS ? (kind as TrophyKind) : "banner";
}

export function kindLabel(award?: TrophyAward | null): string {
  return KIND_LABELS[trophyKind(award)];
}

export function fitsEmblem(award?: TrophyAward | null): boolean {
  return EMBLEM_KINDS.has(trophyKind(award)) && Boolean(award?.reward);
}

function year(value?: string | null): string {
  const match = /(\d{4})$/.exec(awardDay(value));
  return match ? match[1] : "";
}

/** Season bzw. Jahr: die Season der Liga (bzw. die Saison des Vereins), sonst das Jahr des Wettbewerbs. */
export function periodOf(award?: TrophyAward | null): string {
  return award?.reward?.art?.season || award?.season?.name || year(award?.date) || "";
}

export function gameOf(award?: TrophyAward | null): string {
  return award?.game?.name || "";
}

export function placeOf(award?: TrophyAward | null): string {
  if (award?.reward && (award.reward.place_label === ALL_PLACES_LABEL || award.reward.art?.place === ALL_PLACES_LABEL)) return "all";
  const rank = Number(award?.rank);
  return rank >= 1 && rank <= 3 ? String(rank) : "other";
}

/** Name auf der Karte: die Belohnung, sonst der Wettbewerb. */
export function trophyName(award?: TrophyAward | null): string {
  return award?.reward?.name || award?.tournament?.title || "Turnier";
}

/** Der Wettbewerb unter dem Namen: bei Belohnungen Liga · Season und Staffel, bei Turnieren Spiel und Teilnehmerfeld. */
export function competitionLine(award?: TrophyAward | null): string {
  if (!award) return "";
  if (award.reward) {
    const staffel = award.league?.staffel ? `Staffel ${award.league.staffel}` : "";
    return [award.tournament?.title, award.league?.division_label || award.reward.art?.division, staffel].filter(Boolean).join(" · ");
  }
  return [gameOf(award), award.participants ? `${award.participants} Teilnehmer` : ""].filter(Boolean).join(" · ");
}

/** Wohin die Karte führt: die Seite des Wettbewerbs (Gesamtwertung: die Ligaseite, die der Server nennt). */
export function trophyHref(award?: TrophyAward | null): string | null {
  if (award?.url) return award.url;
  const slug = award?.tournament?.slug;
  return slug ? `/tournaments/${encodeURIComponent(slug)}` : null;
}

export function trophyDate(award?: TrophyAward | null): string {
  return awardDay(award?.date);
}

export type TrophyFacets = { kinds: Array<[TrophyKind, string]>; games: string[]; periods: string[]; places: Array<[string, string]> };

/** Was die Filter anbieten - nur, was in der Vitrine vorkommt, in fester Reihenfolge. */
export function trophyFacets(awards?: TrophyAward[] | null): TrophyFacets {
  const list = Array.isArray(awards) ? awards : [];
  const kinds = new Set(list.map(trophyKind));
  const places = new Set(list.map(placeOf));
  const unique = (values: string[]) => [...new Set(values.filter(Boolean))];
  return {
    kinds: TROPHY_KINDS.filter(([key]) => kinds.has(key)),
    games: unique(list.map(gameOf)).sort((a, b) => a.localeCompare(b, "de")),
    periods: unique(list.map(periodOf)).sort((a, b) => b.localeCompare(a, "de", { numeric: true })),
    places: PLACE_FILTERS.filter(([key]) => places.has(key)),
  };
}

export function filterTrophies(awards: TrophyAward[] | null | undefined, filters: TrophyFilters = NO_FILTER): TrophyAward[] {
  const list = Array.isArray(awards) ? awards : [];
  return list.filter((award) => (!filters.kind || trophyKind(award) === filters.kind)
    && (!filters.game || gameOf(award) === filters.game)
    && (!filters.period || periodOf(award) === filters.period)
    && (!filters.place || placeOf(award) === filters.place));
}

export function activeFilters(filters: TrophyFilters = NO_FILTER): number {
  return Object.values(filters).filter(Boolean).length;
}

/** Neueste zuerst, am selben Tag der bessere Platz vorn. */
export function sortTrophies(awards?: TrophyAward[] | null): TrophyAward[] {
  const rank = (award: TrophyAward) => (Number(award?.rank) > 0 ? Number(award.rank) : 999);
  return [...(Array.isArray(awards) ? awards : [])].filter(Boolean).sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")) || rank(a) - rank(b)
    || String(a.id).localeCompare(String(b.id)));
}

/** „12 Trophäen“ bzw. mit Filter „3 von 12“. */
export function trophyCount(shown: number, all: number): string {
  return shown === all ? `${all} ${all === 1 ? "Trophäe" : "Trophäen"}` : `${shown} von ${all}`;
}

/** Ein Emblem dazu oder weg - in der gewählten Reihenfolge, nie mehr als drei. `null`: geht nicht (voll). */
export function toggleEmblem(chosen: Array<string | null | undefined> | null | undefined, awardId: string): string[] | null {
  const list = (Array.isArray(chosen) ? chosen : []).filter(Boolean) as string[];
  if (list.includes(awardId)) return list.filter((id) => id !== awardId);
  if (list.length >= EMBLEM_LIMIT) return null;
  return [...list, awardId];
}

/** Die gezeigten Embleme: nur Belohnungen, höchstens drei - ein alter Server ohne das Feld zeigt nichts. */
export function shownEmblems(emblems?: Array<TrophyAward | null | undefined> | null): TrophyAward[] {
  return (Array.isArray(emblems) ? emblems : []).filter((award): award is TrophyAward => Boolean(award?.reward)).slice(0, EMBLEM_LIMIT);
}

/** Die Embleme aus der eigenen Liste und den gewählten Kennungen (`GET /api/me/awards`) - in der gewählten Reihenfolge. */
export function emblemsFrom(awards: TrophyAward[] | null | undefined, ids: Array<string | null | undefined> | null | undefined): TrophyAward[] {
  const byId = new Map((awards || []).filter(fitsEmblem).map((award) => [award.id, award]));
  return shownEmblems((ids || []).map((id) => (id ? byId.get(id) : undefined)));
}
