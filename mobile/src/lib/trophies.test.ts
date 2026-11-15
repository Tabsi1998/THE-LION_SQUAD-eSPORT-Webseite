import {
  ALL_PLACES_LABEL, NO_FILTER, activeFilters, competitionLine, emblemsFrom, filterTrophies, fitsEmblem, kindLabel, periodOf, placeOf, shownEmblems,
  sortTrophies, toggleEmblem, trophyCount, trophyFacets, trophyHref, trophyKind, trophyName, type TrophyAward,
} from "./trophies";

// Reiter „Trophäen“ (#2425, App: #2173): dieselben Fälle wie im Web (frontend/src/lib/trophies.test.js). Erfundene Namen.

const cup = (id: string, rank: number, extra: Partial<TrophyAward> = {}) => ({
  id, kind: rank <= 3 ? "trophy" : "banner", rank, rank_label: `${rank}. Platz`, date: "2026-03-14T18:00:00Z", participants: 16,
  tournament: { id: `t-${id}`, slug: `cup-${id}`, title: `Frühjahrs-Cup ${id}` }, game: { name: "Rocket League" }, ...extra,
}) as TrophyAward;

const reward = (id: string, kind: string, extra: Partial<TrophyAward> = {}) => ({
  id, kind: "trophy", rank: 1, rank_label: "1. Platz", date: "2026-11-12T20:00:00Z", tournament: { id: "staffel", title: "CoD-Liga · Season 1" },
  league: { division_label: "Liga 1", staffel: "A" }, game: { name: "Call of Duty" },
  reward: { kind, name: `Belohnung ${id}`, art: { season: "Season 1", division: "Liga 1", place: "1. Platz", metal: "gold" } }, ...extra,
}) as TrophyAward;

test("Art: Liga-Belohnungen nach ihrer Vorlage, Turniere als Pokal oder Banner", () => {
  expect(trophyKind(cup("a", 1))).toBe("trophy");
  expect(trophyKind(cup("b", 7))).toBe("banner");
  expect(trophyKind(reward("m", "medal"))).toBe("medal");
  expect(trophyKind(reward("x", "unbekannt"))).toBe("banner");
  expect(kindLabel(reward("e", "emblem"))).toBe("Emblem");
  expect(fitsEmblem(reward("e", "emblem"))).toBe(true);
  expect(fitsEmblem(reward("m", "medal"))).toBe(true);
  expect(fitsEmblem(reward("t", "title"))).toBe(false);
  expect(fitsEmblem(cup("a", 1))).toBe(false);
});

test("Name, Wettbewerb, Link und Platz der Karte", () => {
  expect(trophyName(reward("m", "medal"))).toBe("Belohnung m");
  expect(trophyName(cup("a", 1))).toBe("Frühjahrs-Cup a");
  expect(competitionLine(reward("m", "medal"))).toBe("CoD-Liga · Season 1 · Liga 1 · Staffel A");
  expect(competitionLine(cup("a", 1))).toBe("Rocket League · 16 Teilnehmer");
  expect(trophyHref(cup("a", 1))).toBe("/tournaments/cup-a");
  expect(trophyHref(reward("g", "banner", { url: "/liga/cod/season-1/gesamtwertung" }))).toBe("/liga/cod/season-1/gesamtwertung");
  expect(placeOf(cup("a", 2))).toBe("2");
  expect(placeOf(cup("b", 9))).toBe("other");
  expect(placeOf(reward("all", "banner", { reward: { kind: "banner", name: "Dabei", place_label: ALL_PLACES_LABEL } }))).toBe("all");
});

test("Season bzw. Jahr: die Season der Liga, sonst die Saison, sonst das Jahr", () => {
  expect(periodOf(reward("m", "medal"))).toBe("Season 1");
  expect(periodOf(cup("a", 1, { season: { name: "Saison 2026" } }))).toBe("Saison 2026");
  expect(periodOf(cup("a", 1))).toBe("2026");
});

test("Filter bieten nur, was vorkommt; Filtern, Zählen und Zurücksetzen", () => {
  const all = [cup("a", 1), cup("b", 9, { game: { name: "FIFA" }, date: "2025-05-01T10:00:00Z" }), reward("m", "medal"), reward("t", "title")];
  const facets = trophyFacets(all);
  expect(facets.kinds.map(([key]) => key)).toEqual(["trophy", "medal", "banner", "title"]);
  expect(facets.games).toEqual(["Call of Duty", "FIFA", "Rocket League"]);
  expect(facets.periods).toEqual(["Season 1", "2026", "2025"]);
  expect(facets.places.map(([key]) => key)).toEqual(["1", "other"]);
  expect(filterTrophies(all, { ...NO_FILTER, kind: "medal" }).map((row) => row.id)).toEqual(["m"]);
  expect(filterTrophies(all, { ...NO_FILTER, game: "Rocket League", place: "1" }).map((row) => row.id)).toEqual(["a"]);
  expect(filterTrophies(all, NO_FILTER)).toHaveLength(4);
  expect(activeFilters({ ...NO_FILTER, kind: "medal", game: "FIFA" })).toBe(2);
  expect(trophyCount(4, 4)).toBe("4 Trophäen");
  expect(trophyCount(1, 1)).toBe("1 Trophäe");
  expect(trophyCount(1, 4)).toBe("1 von 4");
  expect(sortTrophies(all).map((row) => row.id)).toEqual(["m", "t", "a", "b"]);
  expect(trophyFacets(null).kinds).toEqual([]);
});

test("Embleme: in der gewählten Reihenfolge, höchstens drei, nur Embleme und Medaillen", () => {
  expect(toggleEmblem([], "a")).toEqual(["a"]);
  expect(toggleEmblem(["a", "b"], "a")).toEqual(["b"]);
  expect(toggleEmblem(["a", "b", "c"], "d")).toBeNull();
  expect(toggleEmblem(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  const list = [reward("e1", "emblem"), reward("m1", "medal"), reward("t1", "title"), cup("c", 1)];
  expect(emblemsFrom(list, ["m1", "t1", "weg", "e1"]).map((row) => row.id)).toEqual(["m1", "e1"]);
  expect(emblemsFrom(list, undefined)).toEqual([]);
  // Ein alter Server ohne das Feld, Einträge ohne Belohnung und mehr als drei: nie mehr als drei Belohnungen.
  expect(shownEmblems(undefined)).toEqual([]);
  expect(shownEmblems([cup("c", 1), reward("1", "emblem"), reward("2", "emblem"), reward("3", "medal"), reward("4", "medal")]).map((row) => row.id)).toEqual(["1", "2", "3"]);
});
