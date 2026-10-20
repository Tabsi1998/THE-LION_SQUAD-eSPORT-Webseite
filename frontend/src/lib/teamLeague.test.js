import {
  OUTCOMES, mapShare, matchPointsLabel, matchdayProgress, pathRankLabel, rankTrend, tableRows, tableTiebreakLabel,
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

test("Liga-Weg: Platz von N, auch ohne Tabelle", () => {
  expect(pathRankLabel({ rank: 2, teams: 8 })).toBe("Platz 2 von 8");
  expect(pathRankLabel({ rank: null, teams: null })).toBe("Noch keine Tabelle");
});
