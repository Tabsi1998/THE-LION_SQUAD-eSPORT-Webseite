import { artLines, metalColor, momentSubtitle, momentTitle, rewardPackages, type RewardAward } from "./leagueRewards";

// Belohnungen der Liga (#2173): dieselben Fälle wie im Web (lib/leagueRewards.test.js, components/tls/rewards/RewardMoment.test.jsx).
// Erfundene Namen.

test("Beschriftung der Vorlage: Season, Liga N, Platz", () => {
  expect(artLines({ season: "Season 1", division: "Liga 2", place: "1. Platz" })).toEqual(["Season 1", "Liga 2", "1. Platz"]);
  expect(artLines(null)).toEqual([]);
});

test("je Staffel ein Paket für die Zeremonie, Überschrift nach Anzahl", () => {
  const moment = (id: string, tournament: string) => ({ id, tournament: { id: tournament }, reward: { name: id, art: { league: "Probe-Liga", season: "Season 1" } } }) as unknown as RewardAward;
  const packages = rewardPackages([moment("a", "t1"), moment("b", "t2"), moment("c", "t1")]);
  expect(packages.map((rows) => rows.map((row) => row.id))).toEqual([["a", "c"], ["b"]]);
  expect(momentTitle(packages[0])).toBe("2 neue Belohnungen");
  expect(momentTitle(packages[1])).toBe("Neue Belohnung");
  expect(momentSubtitle(packages[0])).toBe("Probe-Liga · Season 1");
});

test("Farbe der Vorlage", () => {
  expect(metalColor("gold")).toBe("#FFD700");
  expect(metalColor("unbekannt")).toBe("#29B6E8");
});
