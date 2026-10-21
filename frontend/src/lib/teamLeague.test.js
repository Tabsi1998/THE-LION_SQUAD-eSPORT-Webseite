import {
  OUTCOMES, PICK_LABELS, appearanceText, banText, cellState, mapShare, matchPointsLabel, matchdayProgress, pathRankLabel,
  rankTrend, recordSummary, squadGroups, tableRows, tableTiebreakLabel,
} from "./teamLeague";

// Team-Liga (#1747): nur Beschriftungen und Umformungen dessen, was der Server gespeichert liefert. Erfundene Namen.

test("Punkte für Sieg, Unentschieden und Niederlage kommen aus den Regeln", () => {
  expect(matchPointsLabel({ match_points: { win: 2, draw: 1, loss: 0 } })).toBe("Sieg 2 · Unentschieden 1 · Niederlage 0");
  expect(matchPointsLabel({ match_points: { win: 3, draw: 1.5, loss: 0 } })).toBe("Sieg 3 · Unentschieden 1,5 · Niederlage 0");
  expect(matchPointsLabel(null)).toBe("");
});

test("Vorrang bei Punktgleichheit in Worten", () => {
  expect(tableTiebreakLabel({ table_tiebreakers: ["score_diff", "score_for"] })).toBe("bessere Map-Differenz, dann mehr gewonnene Maps");
  expect(tableTiebreakLabel({ table_tiebreakers: ["wins"] })).toBe("mehr Siege");
  expect(tableTiebreakLabel({ table_tiebreakers: [] })).toBe("Gleichstand teilt den Platz");
});

test("Tabellenzeilen passen in die Rangliste der Turniere", () => {
  const rows = tableRows({ rows: [
    { key: "Fremd Bären", team: "Fremd Bären", rank: 1, previous_rank: 2, points: 4, own: false, form: [] },
    { key: "Probe Löwen", team: "Probe Löwen", rank: 2, previous_rank: 1, points: 2, own: true, form: ["W", "L"] },
  ] });
  expect(rows.map((row) => [row.registration_id, row.display_name, row.is_mine, row.form])).toEqual([
    ["Fremd Bären", "Fremd Bären", false, []], ["Probe Löwen", "Probe Löwen", true, ["W", "L"]]]);
  expect(rows[1].previous_rank).toBe(1);
  expect(tableRows(null)).toEqual([]);
});

test("Spieltage: gespielt, offen, abgesagt und der nächste mit Gegner", () => {
  const days = [
    { round: { id: "a", state: "scored" }, match: { outcome: "win" } },
    { round: { id: "x", state: "cancelled" }, match: null },
    { round: { id: "b", state: "missing" }, match: null },
    { round: { id: "c", state: "planned", opponent: "Fremd Adler" }, match: null },
  ];
  expect(matchdayProgress(days)).toEqual({ total: 3, played: 1, cancelled: 1, next: days[3].round });
  expect(matchdayProgress([])).toEqual({ total: 0, played: 0, cancelled: 0, next: null });
});

test("Map-Anteil für den kleinen Balken, ohne Division durch null", () => {
  expect(mapShare({ score_for: 6, score_against: 2 })).toBe(0.75);
  expect(mapShare({ score_for: 0, score_against: 0 })).toBe(0.5);
});

test("Platzierungsverlauf: Richtung je Spieltag", () => {
  expect(rankTrend([{ rank: 3 }, { rank: 1 }, { rank: 1 }, { rank: 2 }]).map((item) => item.direction)).toEqual([null, "up", "same", "down"]);
  expect(OUTCOMES.win.letter).toBe("S");
});

test("Bilanz (#1931): S-U-N, Maps und Runden mit Differenz – Runden nur aus Spielen mit Maps", () => {
  const item = { team: "Probe Löwen", played: 7, won: 5, drawn: 1, lost: 1, points: 16, maps_for: 15, maps_against: 6, rounds_for: 112, rounds_against: 85, rounds_matches: 7 };
  expect(recordSummary(item)).toEqual({ team: "Probe Löwen", played: 7, won: 5, drawn: 1, lost: 1, points: 16, maps: "15:6", mapsDiff: "+9", rounds: "112:85", roundsDiff: "+27", roundsPartial: false });
  const partial = recordSummary({ ...item, rounds_for: 30, rounds_against: 34, rounds_matches: 2 });
  expect([partial.rounds, partial.roundsDiff, partial.roundsPartial]).toEqual(["30:34", "−4", true]);
  expect(recordSummary({ ...item, rounds_matches: 0 }).rounds).toBe("");
});

test("Maps: wer gewählt hat und Banns aus eigener Sicht in Worten", () => {
  expect(PICK_LABELS).toEqual({ own: "Unsere Wahl", opponent: "Wahl Gegner", decider: "Decider" });
  expect(banText([{ name: "Karte Ost", by: "own" }, { name: "Karte Hafen", by: "opponent" }, { name: "Karte Süd", by: null }]))
    .toBe("Karte Ost (wir) · Karte Hafen (Gegner) · Karte Süd");
  expect(banText([])).toBe("");
});

test("Kader (#1931): je Spieltag gespielt oder Ersatz, „5 von 7“, Gruppen je eigenem Team und Gäste", () => {
  const anna = { key: "a", name: "Anna", club_member: true, guest: false, round_ids: ["r1", "r2"], bench_round_ids: ["r3"], appearances: 2, of: 3, team: "Probe Löwen", in_roster: true };
  const bert = { key: "b", name: "Bert", club_member: true, guest: false, round_ids: [], bench_round_ids: ["r1"], appearances: 0, of: 1, team: "Probe Löwen B", in_roster: true };
  const gast = { key: "g", name: "Gast", club_member: false, guest: true, round_ids: ["r1"], bench_round_ids: [], appearances: 1, of: 1, team: "Probe Löwen", in_roster: false };
  expect(["r1", "r3", "r9"].map((id) => cellState(anna, id))).toEqual(["played", "bench", ""]);
  expect(appearanceText(anna)).toBe("2 von 3");
  expect(appearanceText({ appearances: 4 })).toBe("4");
  const single = squadGroups({ players: [anna, gast] }, ["Probe Löwen"]);
  expect(single.map((group) => [group.key, group.label, group.players.map((player) => player.key)])).toEqual([
    ["members", null, ["a"]], ["guests", "Gäste", ["g"]]]);
  const two = squadGroups({ players: [anna, bert, gast] }, ["Probe Löwen", "Probe Löwen B"]);
  expect(two.map((group) => [group.label, group.players.map((player) => player.key)])).toEqual([
    ["Probe Löwen", ["a"]], ["Probe Löwen B", ["b"]], ["Gäste", ["g"]]]);
});

test("Liga-Weg: Platz von N, auch ohne Tabelle", () => {
  expect(pathRankLabel({ rank: 2, teams: 8 })).toBe("Platz 2 von 8");
  expect(pathRankLabel({ rank: null, teams: null })).toBe("Noch keine Tabelle");
});
