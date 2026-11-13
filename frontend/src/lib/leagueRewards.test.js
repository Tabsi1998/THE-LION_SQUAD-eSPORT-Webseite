import {
  artLines, emptyReward, everyoneLine, groupBySeason, listProblem, metalOf, placeLabel, recipientsLabel, rewardPayload, rewardProblem,
  rewardToForm, rewardsByPlace, rewardsOf,
} from "./leagueRewards";

// Belohnungen der Liga (F.4, #2214): dieselben Texte und Regeln wie der Server. Erfundene Namen.

test("Plätze, Farben und Empfänger lesen sich wie auf dem Server", () => {
  expect(placeLabel({ mode: "rank", rank: 1 })).toBe("1. Platz");
  expect(placeLabel({ mode: "range", from: 4, to: 6 })).toBe("Platz 4–6");
  expect(placeLabel({ mode: "all" })).toBe("Alle Teilnehmer");
  expect([1, 2, 3, 4].map((rank) => metalOf({ mode: "rank", rank }))).toEqual(["gold", "silver", "bronze", "lion"]);
  expect(metalOf({ mode: "all" })).toBe("lion");
  expect(recipientsLabel(["team", "players"])).toBe("Team und Spieler mit Einsatz");
  expect(recipientsLabel(["players"], "roster")).toBe("Ganzer Kader zum Abschluss");
});

test("das Formular prüft wie der Server - und gibt ohne Fehler nichts zurück", () => {
  const ok = { ...emptyReward(), name: "Goldmedaille" };
  expect(rewardProblem(ok)).toBe("");
  expect(rewardProblem({ ...ok, name: "  " })).toBe("Name fehlt.");
  expect(rewardProblem({ ...ok, recipients: [] })).toMatch(/Team, Spieler/);
  expect(rewardProblem({ ...ok, places: { mode: "rank", rank: 0 } })).toMatch(/1 bis 99/);
  expect(rewardProblem({ ...ok, places: { mode: "range", from: 6, to: 4 } })).toMatch(/„bis“/);
  expect(listProblem(Array.from({ length: 21 }, () => ok))).toBe("Höchstens 20 Belohnungen.");
  expect(listProblem([ok, { ...ok, name: "" }])).toBe("Name fehlt.");
});

test("an den Server geht nur, was er kennt - Zahlen als Zahlen, leere Texte als null", () => {
  const form = rewardToForm({ id: "b1", kind: "emblem", name: " Podest ", places: { mode: "range", from: "2", to: "3" }, recipients: ["team"] });
  expect(form.key).toBe("b1");
  expect(rewardPayload(form)).toEqual({ id: "b1", kind: "emblem", name: "Podest", description: "", places: { mode: "range", from: 2, to: 3 },
    recipients: ["team"], image_url: null, prize: null });
  expect(rewardPayload({ ...emptyReward(), name: "Neu" })).not.toHaveProperty("id");
});

const award = (id, season, rank, name, updated) => ({ id, rank, updated_at: updated, league: { season_id: season }, reward: { name, art: { season: `Season ${season}`, league: "Probe-Liga" } } });

test("die Sammlung gruppiert nach Season, die neueste oben, darin Platz 1 zuerst", () => {
  const awards = [award("a", "1", 3, "Bronze", "2026-01-01"), award("b", "2", 2, "Silber", "2026-06-01"), award("c", "1", 1, "Gold", "2026-01-01"),
    { id: "pokal", rank: 1, reward: null }];
  expect(rewardsOf(awards).map((row) => row.id)).toEqual(["a", "b", "c"]);
  const groups = groupBySeason(awards);
  expect(groups.map((group) => group.season)).toEqual(["Season 2", "Season 1"]);
  expect(groups[1].items.map((row) => row.reward.name)).toEqual(["Gold", "Bronze"]);
  expect(groups[1].league).toBe("Probe-Liga");
  expect(artLines({ season: "Season 1", division: "Liga 2", place: "1. Platz" })).toEqual(["Season 1", "Liga 2", "1. Platz"]);
});

test("Ligaseite: je Platz 1 bis 3 die Belohnungen, Bereiche und „alle“ daneben", () => {
  const items = [{ id: "g", name: "Gold", places: { mode: "rank", rank: 1 } }, { id: "p", name: "Podest", places: { mode: "range", from: 2, to: 3 } },
    { id: "a", name: "Season-Banner", places: { mode: "all" } }, { id: "v", name: "Vierter", places: { mode: "rank", rank: 4 } }];
  const { places, others } = rewardsByPlace(items);
  expect(places[1].map((row) => row.id)).toEqual(["g"]);
  expect(places[2]).toEqual([]);
  expect(others.map((row) => row.id)).toEqual(["p", "a", "v"]);
  expect(everyoneLine(items)).toBe("Alle Teilnehmer bekommen: Season-Banner.");
  expect(everyoneLine([items[0]])).toBe("");
});
