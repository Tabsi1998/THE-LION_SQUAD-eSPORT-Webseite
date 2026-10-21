import { todayFacts, todayItems } from "@/lib/homeToday";

// „Heute im Einsatz“ auf der Startseite (#1753): nur, was heute ansteht - mit Runde, Uhrzeit und gemeldeten Vereinsleuten.

const item = (extra = {}) => ({
  lineage: { title: "Probe Monatscup", slug: "probe-monatscup", kind: "series" },
  series: { season: "2026", season_slug: "2026" },
  next: { code: "Q2", title: "", club_day: "2026-11-09", state: "today", time: "20:00" },
  today: true,
  club_count: 2,
  ...extra,
});

test("nur Saisons mit heutigem Termin, unvollständige fallen weg", () => {
  expect(todayItems({ items: [item(), item({ today: false }), { today: true }] })).toHaveLength(1);
  expect(todayItems({})).toEqual([]);
  expect(todayItems(null)).toEqual([]);
});

test("Runde je Art, Uhrzeit, gemeldete Vereinsleute", () => {
  expect(todayFacts(item())).toEqual(["Runde Q2", "20:00 Uhr", "2 Vereinsspieler"]);
  expect(todayFacts(item({ lineage: { kind: "racing" }, club_count: 1 }))).toEqual(["Rennen Q2", "20:00 Uhr", "1 Vereinsfahrer"]);
  expect(todayFacts(item({ lineage: { kind: "team_league" }, next: { title: "Spieltag gegen Probe", state: "today" }, club_count: 0 }))).toEqual(["Spieltag gegen Probe"]);
});

test("Rennwochenende (#1930): der heutige Lauf statt des Worts „Rennen“", () => {
  const next = { code: "R3", session: "Qualifying", club_day: "2026-11-09", state: "today", time: "20:00" };
  expect(todayFacts(item({ lineage: { kind: "racing" }, next, club_count: 2 }))).toEqual(["R3 · Qualifying", "20:00 Uhr", "2 Vereinsfahrer"]);
});
