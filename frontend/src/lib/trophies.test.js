import {
  EMBLEM_LIMIT, NO_FILTER, activeFilters, competitionLine, filterTrophies, fitsEmblem, kindLabel, periodOf, placeOf, sortTrophies, toggleEmblem,
  trophyFacets, trophyHref, trophyKind, trophyName,
} from "./trophies";

// Reiter „Trophäen“ (#2425): Turnier-Pokale und Liga-Belohnungen zusammen, Filter nach Art, Spiel, Season bzw. Jahr und Platz, höchstens
// drei Embleme. Erfundene Daten.

const reward = (id, kind, name, extra = {}) => ({
  id, kind, rank: 1, rank_label: "1. Platz", date: "2026-11-09", game: { name: "Probe Shooter" }, season: { name: "Season 1" },
  tournament: { id: "t1", slug: "probe-a", title: "Probe-Liga · Season 1" }, league: { division_label: "Liga 1", staffel: "A" },
  reward: { id, kind, name, art: { season: "Season 1", division: "Liga 1", place: "1. Platz", metal: "gold" } }, ...extra,
});
const CUP = { id: "cup", kind: "trophy", rank: 2, rank_label: "2. Platz", date: "2025-05-03T12:00:00Z", game: { name: "Rennspiel" }, participants: 12,
  tournament: { id: "t9", slug: "fruehjahrs-cup", title: "Frühjahrs-Cup" }, season: null, reward: null };
const PARTICIPATION = { id: "flag", kind: "banner", rank: 7, rank_label: "7. Platz", date: "2025-02-01", game: { name: "Rennspiel" },
  tournament: { id: "t8", slug: "winter-cup", title: "Winter-Cup" }, reward: null };
const GOLD = reward("gold", "medal", "Goldmedaille");
const EMBLEM = reward("emb", "emblem", "Podest-Emblem", { rank: 3, rank_label: "3. Platz", date: "2026-11-09" });
const TITLE = reward("title", "title", "Kämpferherz", { rank: 4, rank_label: "4. Platz" });
const ALL = [CUP, PARTICIPATION, GOLD, EMBLEM, TITLE];

test("Art: Liga-Belohnung nach der Vorlage, Turnier nach dem Platz - Pokal oder Banner", () => {
  expect(ALL.map(trophyKind)).toEqual(["trophy", "banner", "medal", "emblem", "title"]);
  expect(ALL.map(kindLabel)).toEqual(["Pokal", "Banner", "Medaille", "Emblem", "Titel"]);
  expect(trophyKind({ kind: "reward", reward: { kind: "unbekannt" } })).toBe("banner");
});

test("Karte: Name, Wettbewerb, Season bzw. Jahr, Platz und Link", () => {
  expect(trophyName(GOLD)).toBe("Goldmedaille");
  expect(trophyName(CUP)).toBe("Frühjahrs-Cup");
  expect(competitionLine(GOLD)).toBe("Probe-Liga · Season 1 · Liga 1 · Staffel A");
  expect(competitionLine(CUP)).toBe("Rennspiel · 12 Teilnehmer");
  expect(periodOf(GOLD)).toBe("Season 1");
  expect(periodOf(CUP)).toBe("2025");
  expect(ALL.map(placeOf)).toEqual(["2", "other", "1", "3", "other"]);
  expect(trophyHref(CUP)).toBe("/tournaments/fruehjahrs-cup");
  expect(trophyHref({ ...GOLD, url: "/liga/probe-liga/gesamtwertung" })).toBe("/liga/probe-liga/gesamtwertung");
  expect(trophyHref({ id: "x", tournament: {} })).toBeNull();
});

test("Filter: nur, was vorkommt, und jede Auswahl grenzt ein", () => {
  const facets = trophyFacets(ALL);
  expect(facets.kinds.map(([key]) => key)).toEqual(["trophy", "medal", "banner", "emblem", "title"]);
  expect(facets.games).toEqual(["Probe Shooter", "Rennspiel"]);
  expect(facets.periods).toEqual(["Season 1", "2025"]);
  expect(facets.places.map(([key]) => key)).toEqual(["1", "2", "3", "other"]);
  expect(filterTrophies(ALL, NO_FILTER)).toHaveLength(5);
  expect(filterTrophies(ALL, { ...NO_FILTER, kind: "trophy" }).map((row) => row.id)).toEqual(["cup"]);
  expect(filterTrophies(ALL, { ...NO_FILTER, game: "Rennspiel", place: "other" }).map((row) => row.id)).toEqual(["flag"]);
  expect(filterTrophies(ALL, { ...NO_FILTER, period: "Season 1", kind: "emblem" }).map((row) => row.id)).toEqual(["emb"]);
  expect(filterTrophies(ALL, { ...NO_FILTER, period: "2025", kind: "medal" })).toEqual([]);
  expect(activeFilters({ ...NO_FILTER, game: "Rennspiel", place: "1" })).toBe(2);
  expect(trophyFacets(null)).toEqual({ kinds: [], games: [], periods: [], places: [] });
});

test("Reihenfolge: neueste zuerst, am selben Tag der bessere Platz", () => {
  expect(sortTrophies(ALL).map((row) => row.id)).toEqual(["gold", "emb", "title", "cup", "flag"]);
});

test("Embleme: nur Emblem und Medaille einer Liga-Belohnung, höchstens drei, in der gewählten Reihenfolge", () => {
  expect(ALL.filter(fitsEmblem).map((row) => row.id)).toEqual(["gold", "emb"]);
  expect(fitsEmblem({ id: "x", kind: "medal", reward: null })).toBe(false);
  expect(toggleEmblem([], "a")).toEqual(["a"]);
  expect(toggleEmblem(["a", "b"], "c")).toEqual(["a", "b", "c"]);
  expect(toggleEmblem(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  expect(toggleEmblem(["a", "b", "c"], "d")).toBeNull();
  expect(EMBLEM_LIMIT).toBe(3);
});
