import { leagueCrumbs, leagueTrail, staffelLabel, tournamentCrumbs } from "./leagueTrail";
import { tournamentTabs } from "@/components/tls/tournament/TournamentTabs";

// Liga-Weg einer Staffel (#2110, L-C2). Erfundene Namen.

const LEAGUES = [{ id: "lg1", slug: "probe-liga", name: "Probe-Liga", seasons: [{ id: "s1", slug: "season-1", name: "Season 1" }] }];
const STAFFEL = { id: "t1", slug: "liga-a", title: "Staffel", league_context: { league_id: "lg1", season_id: "s1", staffel: "A" } };

test("leagueTrail findet Liga und Season nur, wenn die Person die Season sieht", () => {
  expect(leagueTrail(LEAGUES, STAFFEL)).toEqual({
    leagueName: "Probe-Liga", seasonName: "Season 1", seasonHref: "/liga/probe-liga/season-1",
    staffelHref: "/liga/probe-liga/season-1#staffel-liga-a", emblemUrl: null,
  });
  // Emblem (#2107): das der Season, sonst das der Liga.
  const emblems = [{ ...LEAGUES[0], emblem_url: "/api/static/uploads/liga.png" }];
  expect(leagueTrail(emblems, STAFFEL).emblemUrl).toBe("/api/static/uploads/liga.png");
  emblems[0].seasons = [{ ...LEAGUES[0].seasons[0], emblem_url: "/api/static/uploads/season.png" }];
  expect(leagueTrail(emblems, STAFFEL).emblemUrl).toBe("/api/static/uploads/season.png");
  expect(leagueTrail([], STAFFEL)).toBeNull();
  expect(leagueTrail(LEAGUES, { id: "x" })).toBeNull();
  expect(leagueTrail(LEAGUES, { ...STAFFEL, league_context: { league_id: "lg1", season_id: "andere" } })).toBeNull();
});

test("leagueCrumbs: Liga · Season · Staffel, darunter das Spiel; ohne Season kein toter Link", () => {
  const trail = leagueTrail(LEAGUES, STAFFEL);
  expect(leagueCrumbs(STAFFEL, trail).map((item) => [item.label, item.to])).toEqual([
    ["Start", "/"], ["Liga", "/liga"], ["Probe-Liga Season 1", "/liga/probe-liga/season-1"], ["Staffel A", undefined],
  ]);
  const match = leagueCrumbs(STAFFEL, trail, { tournamentUrl: "/tournaments/liga-a", current: { label: "Match L1" } });
  expect(match.map((item) => item.to)).toEqual(["/", "/liga", "/liga/probe-liga/season-1", "/tournaments/liga-a", undefined]);
  expect(leagueCrumbs(STAFFEL, null, { tournamentUrl: "/tournaments/liga-a", current: { label: "Match L1" } })
    .map((item) => [item.label, item.to])).toEqual([["Start", "/"], ["Liga", undefined], ["Staffel A", "/tournaments/liga-a"], ["Match L1", undefined]]);
  expect(leagueCrumbs({ id: "cup" }, null)).toBeNull();
  expect(staffelLabel({ league_context: {} })).toBe("Staffel");
});

test("tournamentTabs: der Reiter „Liga“ nur mit sichtbarer Season", () => {
  const trail = leagueTrail(LEAGUES, STAFFEL);
  const tabs = tournamentTabs(STAFFEL, "", null, trail);
  expect(tabs.at(-1)).toMatchObject({ key: "league", label: "Liga", to: "/liga/probe-liga/season-1#staffel-liga-a" });
  expect(tournamentTabs(STAFFEL).map((tab) => tab.key)).not.toContain("league");
});

test("tournamentCrumbs (#2124): eine Kette für alle Turnierseiten - mit eSports, bei Staffeln der Liga-Weg", () => {
  const cup = { id: "t9", slug: "cup", title: "Herbst-Cup" };
  expect(tournamentCrumbs(cup, null).map((item) => [item.label, item.to])).toEqual([
    ["Start", "/"], ["eSports", "/esports"], ["Turniere", "/tournaments"], ["Herbst-Cup", undefined],
  ]);
  expect(tournamentCrumbs(cup, null, { tournamentUrl: "/tournaments/cup", current: { label: "Spielplan" } }).map((item) => [item.label, item.to])).toEqual([
    ["Start", "/"], ["eSports", "/esports"], ["Turniere", "/tournaments"], ["Herbst-Cup", "/tournaments/cup"], ["Spielplan", undefined],
  ]);
  const trail = leagueTrail(LEAGUES, STAFFEL);
  expect(tournamentCrumbs(STAFFEL, trail, { tournamentUrl: "/tournaments/liga-a", current: { label: "Rangliste" } }).map((item) => item.label))
    .toEqual(["Start", "Liga", "Probe-Liga Season 1", "Staffel A", "Rangliste"]);
});