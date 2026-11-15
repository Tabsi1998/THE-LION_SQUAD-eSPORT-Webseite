import { artLines, groupBySeason, metalColor, momentSubtitle, momentTitle, rewardMeta, rewardPackages, rewardsOf, withoutRewards, type RewardAward } from "./leagueRewards";

// Belohnungen der Liga (#2173): dieselben Fälle wie im Web (lib/leagueRewards.test.js, components/tls/rewards/RewardMoment.test.jsx).
// Erfundene Namen.

const award = (id: string, season: string, rank: number, name: string, updated: string) => ({
  id, rank, rank_label: `${rank}. Platz`, kind: "trophy", updated_at: updated, league: { season_id: season },
  reward: { name, art: { season: `Season ${season}`, league: "Probe-Liga" } },
}) as unknown as RewardAward;

test("die Sammlung gruppiert nach Season, die neueste oben, darin Platz 1 zuerst", () => {
  const pokal = { id: "pokal", rank: 1, rank_label: "1. Platz", kind: "trophy", reward: null } as unknown as RewardAward;
  const awards = [award("a", "1", 3, "Bronze", "2026-01-01"), award("b", "2", 2, "Silber", "2026-06-01"), award("c", "1", 1, "Gold", "2026-01-01"), pokal];
  expect(rewardsOf(awards).map((row) => row.id)).toEqual(["a", "b", "c"]);
  expect(withoutRewards(awards).map((row) => row.id)).toEqual(["pokal"]);
  const groups = groupBySeason(awards);
  expect(groups.map((group) => group.season)).toEqual(["Season 2", "Season 1"]);
  expect(groups[1].items.map((row) => row.reward?.name)).toEqual(["Gold", "Bronze"]);
  expect(groups[1].league).toBe("Probe-Liga");
  expect(artLines({ season: "Season 1", division: "Liga 2", place: "1. Platz" })).toEqual(["Season 1", "Liga 2", "1. Platz"]);
  expect(groupBySeason(null)).toEqual([]);
});

test("je Staffel ein Paket für die Zeremonie, Überschrift nach Anzahl", () => {
  const moment = (id: string, tournament: string) => ({ id, tournament: { id: tournament }, reward: { name: id, art: { league: "Probe-Liga", season: "Season 1" } } }) as unknown as RewardAward;
  const packages = rewardPackages([moment("a", "t1"), moment("b", "t2"), moment("c", "t1")]);
  expect(packages.map((rows) => rows.map((row) => row.id))).toEqual([["a", "c"], ["b"]]);
  expect(momentTitle(packages[0])).toBe("2 neue Belohnungen");
  expect(momentTitle(packages[1])).toBe("Neue Belohnung");
  expect(momentSubtitle(packages[0])).toBe("Probe-Liga · Season 1");
});

test("Zeile unter dem Namen und Farbe der Vorlage", () => {
  const row = { id: "x", rank: 1, rank_label: "1. Platz", kind: "trophy", league: { division_label: "Liga 1", staffel: "A" }, reward: { name: "Gold", art: { place: "1. Platz", metal: "gold" } } } as unknown as RewardAward;
  expect(rewardMeta(row)).toBe("1. Platz · Liga 1 · Staffel A");
  expect(metalColor("gold")).toBe("#FFD700");
  expect(metalColor("unbekannt")).toBe("#29B6E8");
});
