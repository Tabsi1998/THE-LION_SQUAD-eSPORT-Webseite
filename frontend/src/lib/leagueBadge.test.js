import { describe, expect, it } from "vitest";
import { badgeAria, badgeLabel, badgeMetal, badgeTier, currentPlace, exitLabel, ladderValue, lineRuns, nextMatchText, seasonLabelLines, seasonLine } from "./leagueBadge";
import { runAtTestClock } from "@/testClock";

// Feste Uhr (#1307): die Datums-Texte lassen das laufende Jahr weg und sagen „heute“/„morgen“.
runAtTestClock();

describe("Liga-Abzeichen (#1638)", () => {
  it("zeigt die Stufe über die Form: Liga 1 oben, Liga 2 mittel, ab Liga 3 schlicht", () => {
    expect(badgeTier(1)).toBe("top");
    expect(badgeTier(2)).toBe("mid");
    expect(badgeTier(3)).toBe("base");
    expect(badgeTier(12)).toBe("base");
    expect(badgeTier(0)).toBe(null);
    expect(badgeTier("x")).toBe(null);
  });

  it("nimmt Cyan und Gold nur für den Season-Meister", () => {
    expect(badgeMetal({ level: 1 })).toBe("cyan");
    expect(badgeMetal({ level: 3, champion: true })).toBe("gold");
  });

  it("schreibt den Beinamen neben die Liga N", () => {
    expect(badgeLabel({ level: 1, nickname: "Elite" })).toBe("Liga 1 · Elite");
    expect(badgeLabel({ level: 2, nickname: "  " })).toBe("Liga 2");
    expect(badgeLabel({ level: 2 })).toBe("Liga 2");
    expect(badgeLabel(null)).toBe("");
  });

  it("nennt den Meister auch für Screenreader", () => {
    expect(badgeAria({ level: 1, nickname: "Elite", champion: true })).toBe("Liga 1 · Elite, Season-Meister");
    expect(badgeAria({ level: 4 })).toBe("Liga 4");
  });
});

describe("Aktuelle Ligen (#1630)", () => {
  it("sagt Platz von N erst mit dem ersten Ergebnis", () => {
    expect(currentPlace({ rank: 3, of: 8 })).toBe("Platz 3 von 8");
    expect(currentPlace({ rank: null, of: 8 })).toBe("Noch ohne Ergebnis · 8 Teams");
    expect(currentPlace({ rank: null, of: null })).toBe("Noch ohne Ergebnis");
  });

  it("beschreibt das nächste Spiel mit Gegner, Termin oder Spieltag", () => {
    expect(nextMatchText({ opponent: "Probe B", scheduled_at: "2026-11-25T19:00:00Z", matchday: 3 }))
      .toBe("gegen Probe B · Mi 25. November · 20:00");
    expect(nextMatchText({ opponent: null, scheduled_at: null, matchday: 4 })).toBe("Spieltag 4");
    expect(nextMatchText(null)).toBe("");
  });
});

describe("Saisonverlauf als Linie (#1630)", () => {
  const rows = [
    { season_id: "s3", season_name: "Season 3", closed_at: "2026-09-01", rank: 1, of: 4, badge: { level: 1 }, display_name: "Lions A", champion: true },
    { season_id: "s1", season_name: "Season 1", closed_at: "2026-03-01", rank: 2, of: 4, badge: { level: 2 }, display_name: "Lions A" },
    { season_id: "s2", season_name: "Season 2", closed_at: "2026-06-01", rank: 1, of: 4, badge: { level: 2 }, display_name: "Lions A", zone: "promotion" },
    { season_id: "s2", season_name: "Season 2", closed_at: "2026-06-01", rank: 4, of: 4, badge: { level: 2 }, display_name: "Lions B" },
  ];

  it("rechnet Liga N und Platz auf eine Leiter: Liga 1 Platz 1 ganz oben", () => {
    expect(ladderValue({ rank: 1, of: 4, badge: { level: 1 } })).toBe(0);
    expect(ladderValue({ rank: 4, of: 4, badge: { level: 1 } })).toBe(0.75);
    expect(ladderValue({ rank: 1, of: 4, badge: { level: 2 } })).toBe(1);
    expect(ladderValue({ rank: 1, of: 4 })).toBe(null);
    expect(ladderValue({ exit: "withdrawn", rank: 2, of: 4, badge: { level: 1 } })).toBe(null);
  });

  it("ordnet die Seasons nach der Zeit und trennt Co-Teams in eigene Linien", () => {
    const line = seasonLine(rows, { byTeam: true });
    expect(line.seasons.map((season) => season.name)).toEqual(["Season 1", "Season 2", "Season 3"]);
    expect(line.series.map((series) => series.name)).toEqual(["Lions A", "Lions B"]);
    expect(line.series[0].points.map((point) => [point.index, point.rank, point.level])).toEqual([[0, 2, 2], [1, 1, 2], [2, 1, 1]]);
    expect(line.series[0].points[2].champion).toBe(true);
    expect(line.levels).toEqual([1, 2]);
  });

  it("zeigt im Profil eine Linie für die Person - eine Season, ein Punkt", () => {
    const line = seasonLine(rows.slice(0, 3), { byTeam: false });
    expect(line.series).toHaveLength(1);
    expect(line.series[0].points).toHaveLength(3);
  });

  it("braucht zwei Seasons, sonst gibt es keine Linie", () => {
    expect(seasonLine(rows.slice(0, 1), { byTeam: false })).toBe(null);
    expect(seasonLine([], { byTeam: true })).toBe(null);
  });
});

describe("Saisonverlauf an der Teamseite: die besten Co-Teams zuerst (#1630, Fabian 23.11.)", () => {
  const row = (team, number, level, rank) => ({ season_id: `s${number}`, season_name: `Season ${number}`, closed_at: `2026-0${number}-01`,
    rank, of: 6, badge: { level }, display_name: team });

  it("ordnet nach der aktuellen Liga N und dann dem Platz der letzten Season - nicht nach dem besten Wert von früher", () => {
    const line = seasonLine([
      row("Früher oben", 1, 1, 1), row("Früher oben", 2, 3, 5),
      row("Jetzt Liga 1", 1, 2, 2), row("Jetzt Liga 1", 2, 1, 4),
      row("Jetzt Liga 1 vorn", 2, 1, 2),
    ], { byTeam: true });
    expect(line.series.map((series) => series.name)).toEqual(["Jetzt Liga 1 vorn", "Jetzt Liga 1", "Früher oben"]);
  });
});

describe("Review #1638: Statushinweis und nur gezeigte Linien", () => {
  it("nennt Warteliste bzw. offene Anmeldung statt „Noch ohne Ergebnis“", () => {
    expect(currentPlace({ rank: null, of: 6, status_note: "Warteliste" })).toBe("Warteliste");
    expect(currentPlace({ rank: null, of: 6, status_note: "Anmeldung offen" })).toBe("Anmeldung offen");
    expect(currentPlace({ rank: 2, of: 6, status_note: "Warteliste" })).toBe("Platz 2 von 6");
  });

  const row = (team, number, level, rank) => ({ season_id: `s${number}`, season_name: `Season ${number}`, closed_at: `2026-0${number}-01`,
    rank, of: 6, badge: { level }, display_name: team });

  it("nimmt Seasons und Liga-Bänder nur aus den gezeigten Linien und zählt den Rest", () => {
    const rows = [row("Kader A", 1, 1, 1), row("Kader A", 2, 1, 1), row("Kader B", 1, 2, 1), row("Kader B", 2, 2, 2),
      row("Kader Z", 1, 5, 6), row("Kader Z", 2, 5, 6), row("Kader Z", 3, 5, 6)];
    const line = seasonLine(rows, { byTeam: true, limit: 2 });
    expect(line.series.map((series) => series.name)).toEqual(["Kader A", "Kader B"]);
    expect(line.hidden).toBe(1);
    expect(line.levels).toEqual([1, 2]);
    expect(line.seasons.map((season) => season.name)).toEqual(["Season 1", "Season 2"]);
    expect(seasonLine(rows, { byTeam: true }).levels).toEqual([1, 2, 5]);
  });
});

describe("Review #1638: Season-Namen, Rückzug und Reihenfolge der Linien", () => {
  const row = (team, number, level, rank, extra = {}) => ({ season_id: `s${number}`, season_name: `Season ${number}`, closed_at: `2026-0${number}-01`,
    rank, of: 6, badge: level ? { level } : null, display_name: team, ...extra });

  it("teilt einen langen Season-Namen am Leerzeichen nahe der Mitte in zwei Zeilen und kürzt nie", () => {
    expect(seasonLabelLines("Herbst 2026/27")).toEqual(["Herbst", "2026/27"]);
    expect(seasonLabelLines("Season 3")).toEqual(["Season 3"]);
    expect(seasonLabelLines("Donaudampfschifffahrtssaison")).toEqual(["Donaudampfschifffahrtssaison"]);
    expect(seasonLabelLines("Große  Frühjahrs Season 2026")).toEqual(["Große Frühjahrs", "Season 2026"]);
    expect(seasonLabelLines("Herbst 2026/27").join(" ")).not.toContain("…");
  });

  it("setzt die Season eines Rückzugs auf die Achse, ohne Platz, in ihrer Liga N", () => {
    const line = seasonLine([row("Kader A", 1, 2, 1), row("Kader A", 2, 2, 3, { exit: "withdrawn" }), row("Kader A", 3, 1, 2)]);
    expect(line.seasons.map((season) => season.name)).toEqual(["Season 1", "Season 2", "Season 3"]);
    const exit = line.series[0].points[1];
    expect(exit).toMatchObject({ index: 1, exit: "withdrawn", value: null, rank: null, level: 2, champion: false });
    expect(line.levels).toEqual([1, 2]);
  });

  it("nimmt bei einem Rückzug ohne Liga N die Liga N der Season davor", () => {
    const line = seasonLine([row("Kader A", 1, 3, 1), row("Kader A", 2, null, null, { exit: "disqualified" }), row("Kader A", 3, 3, 2)]);
    expect(line.series[0].points[1]).toMatchObject({ exit: "disqualified", level: 3 });
    expect(exitLabel("disqualified")).toBe("disqualifiziert");
    expect(exitLabel("withdrawn")).toBe("ausgetreten");
  });

  it("im Profil schlägt ein gewerteter Eintrag derselben Season den Rückzug", () => {
    const line = seasonLine([row("Kader A", 1, 2, 1), row("Kader A", 2, 2, 3, { exit: "withdrawn" }), row("Kader B", 2, 3, 4)]);
    expect(line.series[0].points[1]).toMatchObject({ exit: null, rank: 4, level: 3 });
  });

  it("zeigt keine Linie, wenn es außer Rückzügen keinen Platz gibt", () => {
    expect(seasonLine([row("Kader A", 1, 2, 1, { exit: "withdrawn" }), row("Kader A", 2, 2, 1, { exit: "withdrawn" })])).toBe(null);
  });

  it("unterbricht die Linie am Rückzug", () => {
    const points = [{ index: 0 }, { index: 1 }, { index: 2, exit: "withdrawn" }, { index: 3 }];
    expect(lineRuns(points).map((run) => run.map((point) => point.index))).toEqual([[0, 1], [3]]);
    expect(lineRuns([{ index: 0, exit: "withdrawn" }])).toEqual([]);
  });

  it("stellt Co-Teams, die gerade spielen, vor die übrigen - dann nach der Liga N der letzten Season", () => {
    const rows = [row("Früher Liga 1", 1, 1, 1), row("Früher Liga 1", 2, 1, 1),
      row("Spielt Liga 3", 1, 3, 2, { squad_id: "sq-3" }), row("Spielt Liga 3", 2, 3, 1, { squad_id: "sq-3" }),
      row("Spielt Liga 2", 1, 2, 5), row("Spielt Liga 2", 2, 2, 4)];
    const line = seasonLine(rows, { byTeam: true, playing: ["sq-3", "Spielt Liga 2"] });
    expect(line.series.map((series) => series.name)).toEqual(["Spielt Liga 2", "Spielt Liga 3", "Früher Liga 1"]);
    expect(seasonLine(rows, { byTeam: true }).series[0].name).toBe("Früher Liga 1");
  });

  it("ein Rückzug in der letzten Season zählt wie der letzte Platz seiner Liga N", () => {
    const rows = [row("Raus", 1, 2, 1), row("Raus", 2, 2, null, { exit: "withdrawn" }), row("Drin", 1, 2, 6), row("Drin", 2, 2, 6)];
    expect(seasonLine(rows, { byTeam: true }).series.map((series) => series.name)).toEqual(["Drin", "Raus"]);
  });
});
