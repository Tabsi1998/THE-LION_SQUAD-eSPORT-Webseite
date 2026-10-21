import type { SeasonPage } from "./referenceSeason";
import { seasonTabs } from "./referenceSeason";
import { banText, leagueTableRows, mapStatCards, matchdayCards, matchWhen, poolGroups, squadGroups, tournamentPoolSections, vetoLabel } from "./teamLeague";

// Team-Liga in der App (#1931, #1616, #1974) - dieselben Regeln und Texte wie im Web (frontend/src/lib/teamLeague.js,
// teamLeagueMaps.js, mapPools.js, components/tls/series/TeamLeague.jsx). Nur erfundene Namen.

const IMG = "/api/static/uploads/hafenkante.webp";
const PAGE: SeasonPage = {
  lineage: { kind: "team_league" },
  rounds: [{ id: "a", code: "ST1" }, { id: "b", code: "ST2" }],
  team_league: {
    own_teams: ["Lions Probe"],
    matchdays: [
      {
        round: { id: "a", code: "ST1", club_day: "2026-10-01", time: "20:00", state: "scored" },
        match: {
          opponent: "Fremd Adler", home: true, outcome: "win", score_for: 2, score_against: 1, points: 3,
          maps: [{ name: "Hafenkante", score_for: 6, score_against: 3, outcome: "win", picked: "own" }],
          bans: [{ name: "Nebelwerk", by: "own" }, { name: "Sturmdeck", by: "opponent" }],
          veto: [
            { name: "Nebelwerk", role: "banned", played: false, by: "own" },
            { name: "Hafenkante", role: "picked", by: "own", picked: "own", played: true, score_for: 6, score_against: 3, outcome: "win" },
            { name: "Glutsenke", role: "decider", picked: "decider", played: false },
          ],
        },
        others: [{ home: "Fremd Bären", away: "Fremd Wölfe", home_score: 2, away_score: 0 }],
      },
      { round: { id: "b", code: "ST2", club_day: "2026-10-08", time: "20:00", state: "planned", opponent: "Fremd Bären", at_home: false }, match: null, matches: [] },
    ],
    table: { rows: [{ key: "Fremd", team: "Fremd Adler", rank: 1, points: 6, played: 2, own: false }, { key: "Lions", team: "Lions Probe", rank: 2, points: 3.5, played: 1, own: true }] },
    lineup: { round_ids: ["a", "b"], players: [
      { key: "p1", name: "Mira Stahl", club_member: true, guest: false, round_ids: ["a"], bench_round_ids: ["b"], appearances: 5, of: 7, all_seasons: 12, team: "Lions Probe" },
      { key: "p2", name: null, name_hidden: true, club_member: false, guest: true, round_ids: ["a"], appearances: 1, of: 7 },
    ] },
    map_stats: [{ name: "Hafenkante", image_url: IMG, map_id: "hafen", played: 3, won: 2, drawn: 0, lost: 1, picked_own: 2, picked_opponent: 0, picked: 0, decider: 0, banned_own: 0, banned_opponent: 1, banned: 0 }],
  },
  map_pool: { modes: [{ mode: null, label: "Alle Maps", maps: [{ map_id: "hafen", name: "Hafenkante", image_url: IMG }, { map_id: "glut", name: "Glutsenke", image_url: null }] }] },
};

test("Spieltag-Karten (#1931): Gegner, Heim/Auswärts, Ergebnis aus eigener Sicht, Maps als Liste mit Banns", () => {
  const [first, second] = matchdayCards(PAGE);
  expect(first.matches).toHaveLength(1);
  const match = first.matches[0];
  expect([match.opponent, match.side, match.score, match.letter, match.label]).toEqual(["gegen Fremd Adler", "Heim", "2:1", "S", "Sieg 2:1, 3 Punkte"]);
  // Ohne Bilder: die Liste ohne Banns (aus dem Veto), ungespielte Maps gedimmt, dazu die Banns in Worten.
  expect(match.veto).toEqual([]);
  expect(match.maps.map((map) => [map.name, map.pick, map.score, map.played])).toEqual([["Hafenkante", "Unsere Wahl", "6:3", true], ["Glutsenke", "Decider", "", false]]);
  expect(match.bans).toBe("Nebelwerk (wir) · Sturmdeck (Gegner)");
  expect(first.others).toEqual([{ key: "a-other-0", home: "Fremd Bären", away: "Fremd Wölfe", score: "2:0" }]);
  // Offen: Stand und der Gegner aus dem Kalender.
  expect([second.state, second.opponent, second.side, second.matches.length]).toEqual(["Geplant", "gegen Fremd Bären", "Auswärts", 0]);
});

test("Veto-Karten mit Bild (#1616): Bann, Wahl, Decider, nicht gespielt - die Liste und die Banns fallen dann weg", () => {
  const withImages: SeasonPage = { ...PAGE, team_league: { ...PAGE.team_league, matchdays: [{ ...PAGE.team_league!.matchdays![0], match: { ...PAGE.team_league!.matchdays![0].match!, veto: PAGE.team_league!.matchdays![0].match!.veto!.map((step) => ({ ...step, image_url: IMG })) } }] } };
  const match = matchdayCards(withImages)[0].matches[0];
  expect(match.veto.map((card) => [card.label, card.name, card.banned, card.played, card.score, card.result, card.tone])).toEqual([
    ["Bann · wir", "Nebelwerk", true, false, "", "", "plain"],
    ["Unsere Wahl", "Hafenkante", false, true, "6:3", "gewonnen", "own"],
    ["Decider", "Glutsenke", false, false, "", "nicht gespielt", "decider"],
  ]);
  expect(match.bans).toBe("");
  expect(vetoLabel({ role: "picked", by: "opponent" })).toBe("Wahl Gegner");
  expect(vetoLabel({ role: "banned" })).toBe("Bann");
  expect(banText([{ name: "Nebelwerk" }])).toBe("Nebelwerk");
});

test("Mehrere eigene Teams (#1926) und mehrere Spiele an einem Spieltag: je Spiel ein Block mit eigenem Team", () => {
  const two: SeasonPage = { ...PAGE, team_league: { ...PAGE.team_league, own_teams: ["Lions A", "Lions B"], matchdays: [{
    round: { id: "a", code: "ST1", state: "scored" },
    matches: [{ team: "Lions A", opponent: "Fremd Adler", home: true, outcome: "win", score_for: 2, score_against: 0 }, { team: "Lions B", opponent: "Fremd Bären", home: false, outcome: "loss", score_for: 1, score_against: 2 }],
  }] } };
  const card = matchdayCards(two)[0];
  expect(card.matches.map((match) => [match.team, match.opponent, match.score])).toEqual([["Lions A", "gegen Fremd Adler", "2:0"], ["Lions B", "gegen Fremd Bären", "1:2"]]);
});

test("Tag eines Spiels: eigener Tag bzw. eigene Uhrzeit, Spieltag über mehrere Tage", () => {
  expect(matchWhen({ id: "a", club_day: "2026-05-13", time: "20:00" }, { club_day: "2026-05-14", time: "21:00" })).toBe("Do., 14.05.2026 · 21:00");
  expect(matchWhen({ id: "a", club_day: "2026-05-13", club_day_end: "2026-05-17" }, { time: "21:00" })).toBe("Mi., 13.05. – So., 17.05.2026 · 21:00");
  expect(matchWhen({ id: "a", club_day: "2026-05-13", time: "20:00" }, null)).toBe("Mi., 13.05.2026 · 20:00");
});

test("Tabelle, Kader mit Einsätzen (E = Ersatz) und Gästen, Statistik je Map, Map-Pool", () => {
  expect(leagueTableRows(PAGE).map((row) => [row.pos, row.name, row.played, row.points, row.own])).toEqual([["1", "Fremd Adler", "2", "6", false], ["2", "Lions Probe", "1", "3,5", true]]);
  const groups = squadGroups(PAGE);
  expect(groups.map((group) => [group.key, group.label, group.players.map((player) => player.name)])).toEqual([["members", "", ["Mira Stahl"]], ["guests", "Gäste", ["Name ausgeblendet"]]]);
  const mira = groups[0].players[0];
  expect([mira.appearances, mira.total, mira.cells.map((cell) => `${cell.code}:${cell.state}`)]).toEqual(["5 von 7", "12", ["ST1:played", "ST2:bench"]]);
  expect(groups[1].players[0]).toMatchObject({ hidden: true, total: "", appearances: "1 von 7" });
  expect(mapStatCards(PAGE)[0].figures.map((figure) => `${figure.label} ${figure.value}`)).toEqual(["Gespielt 3", "Siege 2", "Niederlagen 1", "Unsere Wahl 2", "Bann Gegner 1"]);
  expect(poolGroups(PAGE.map_pool)).toEqual([{ key: "alle-0", heading: "", count: "2 Maps", maps: [{ key: "hafen", name: "Hafenkante", image: IMG }, { key: "glut", name: "Glutsenke", image: "" }] }]);
  expect(seasonTabs(PAGE).map((tab) => tab.label)).toEqual(["Spieltage", "Tabelle", "Kader", "Maps"]);
});

test("Map-Pools eines Turniers: der des Turniers und je Phase mit eigenem Pool", () => {
  const pool = (name: string) => ({ modes: [{ mode: "snd", label: "Suchen & Zerstören", maps: [{ map_id: name, name }] }] });
  const sections = tournamentPoolSections({ tournament: pool("Hafenkante"), stages: [{ stage_id: "s1", name: "Gruppenphase", pool: { ...pool("Hafenkante"), origin: "tournament" } }, { stage_id: "s2", name: "Finale", pool: { ...pool("Glutsenke"), origin: "stage" } }] });
  expect(sections.map((section) => [section.title, section.groups[0].heading, section.groups[0].count])).toEqual([["Map-Pool", "Suchen & Zerstören", "1 Map"], ["Map-Pool · Finale", "Suchen & Zerstören", "1 Map"]]);
  expect(tournamentPoolSections(null)).toEqual([]);
});

test("älterer Server ohne Team-Liga-Felder: leer, nur Spieltage und Tabelle, kein Absturz", () => {
  const old: SeasonPage = { lineage: { kind: "team_league" }, team_league: { matchdays: [{ round: { id: "a", code: "ST1", state: "scored" }, match: { opponent: "Fremd Adler", home: true, outcome: "win", score_for: 3, score_against: 1, maps: [{ name: "Hacienda", score_for: 6, score_against: 2 }] } }] } };
  const card = matchdayCards(old)[0];
  expect(card.matches[0].maps.map((map) => [map.name, map.score, map.pick])).toEqual([["Hacienda", "6:2", ""]]);
  expect(card.others).toEqual([]);
  expect(seasonTabs(old).map((tab) => tab.label)).toEqual(["Spieltage", "Tabelle"]);
  expect(matchdayCards({ team_league: null })).toEqual([]);
  expect(squadGroups({})).toEqual([]);
  expect(mapStatCards({})).toEqual([]);
  expect(poolGroups(null)).toEqual([]);
  expect(leagueTableRows({})).toEqual([]);
});
