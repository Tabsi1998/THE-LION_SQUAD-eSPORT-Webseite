import {
  applicationTone, applicationsForSquads, carryLine, finalNote, historyMovement, historyPlace, historyWhere, knownZone, lateEntryText, staffelApiPath, teamStateLabel,
  winnerLabel, zoneLegend,
  ZONE_LABELS,
} from "./leagueTeam";

// Liga an Team, Profil und Tabelle (#2173): dieselben Fälle wie im Web (lib/leagueApplications.test.js, lib/leagueZones.test.js,
// lib/leagueFinal.js, components/tls/league/LeagueSeasonHistory.jsx). Wiener Zeit, unabhängig vom Rechner.

test("Anmeldestatus fürs eigene Team: angenommen heißt „Angemeldet“, ohne Staffel mit „Zuteilung folgt“", () => {
  expect(teamStateLabel("accepted", { staffel: "Liga 1 · Staffel A" })).toBe("Angemeldet");
  expect(teamStateLabel("accepted", { staffel: null })).toBe("Angemeldet – Zuteilung folgt");
  expect(teamStateLabel("accepted", { staffel: "Liga 1 · Staffel A", staffel_left: true })).toBe("Angenommen");
  expect(teamStateLabel("submitted", null)).toBe("Eingereicht");
  expect(teamStateLabel("unbekannt", null)).toBe("Nicht angemeldet");
  expect(applicationTone("waitlist")).toBe("warn");
  expect(applicationTone("accepted")).toBe("ok");
});

test("übernommen aus der Vorgänger-Season: Herkunft, Richtung und Frist zum Abmelden", () => {
  expect(carryLine({ from_season_name: "Season 1", from_label: "Liga 2", division_label: "Liga 1", movement: "up", withdraw_until: "2027-01-05T17:00:00Z" }))
    .toBe("Übernommen aus Season 1: Liga 1 (Aufstieg aus Liga 2). Abmelden bis zum Start am 05.01.2027, 18:00 Uhr.");
  expect(carryLine({ from_season_name: "Season 1", from_label: "Liga 1", division_label: "Liga 2", movement: "down" })).toBe("Übernommen aus Season 1: Liga 2 (Abstieg aus Liga 1).");
  expect(carryLine({ division_label: "Liga 1", movement: "stay" })).toBe("Übernommen aus der Vorgänger-Season: Liga 1.");
  expect(carryLine(null)).toBe("");
});

test("nur die Anträge der Co-Teams dieses Teams", () => {
  const items = [{ id: "a", squad_id: "s1" }, { id: "b", squad_id: "s2" }, { id: "c", squad_id: "fremd" }];
  expect(applicationsForSquads(items, ["s1", "s2", null]).map((row) => row.id)).toEqual(["a", "b"]);
  expect(applicationsForSquads(null, ["s1"])).toEqual([]);
});

test("Zonen: in der Legende nur, was vorkommt - in fester Reihenfolge; unbekannte Zonen zählen nicht", () => {
  const rows = [{ zone: "relegation" }, { zone: null }, { zone: "promotion" }, { zone: "out" }];
  expect(zoneLegend(rows)).toEqual([{ zone: "promotion", label: ZONE_LABELS.promotion }, { zone: "relegation", label: ZONE_LABELS.relegation }]);
  expect(zoneLegend([{ zone: null }])).toEqual([]);
  expect(knownZone("playoff_promotion")).toBe("playoff_promotion");
  expect(knownZone("out")).toBeNull();
});

test("Endstand über der Tabelle", () => {
  expect(finalNote({ closed_at: "2026-11-12T20:00:00Z" })).toBe("Endstand · abgeschlossen am 12.11.2026");
  expect(finalNote({})).toBe("Endstand");
  expect(finalNote(null)).toBe("");
});

test("Season-Historie: Platz von wie vielen, Ausgeschiedene im Klartext, Auf- und Abstieg mit Richtung", () => {
  expect(historyPlace({ rank: 2, of: 8 })).toBe("Platz 2 von 8");
  expect(historyPlace({ rank: 3 })).toBe("Platz 3");
  expect(historyPlace({ rank: 7, of: 8, exit: "withdrawn" })).toBe("ausgetreten");
  expect(historyPlace({ rank: 7, of: 8, exit: "irgendwas" })).toBe("ausgeschieden");
  expect(historyWhere({ division_label: "Liga 1", staffel: "A", display_name: "Löwen" }, true)).toBe("Liga 1 · Staffel A · Löwen");
  expect(historyWhere({ division_label: "Liga 1", staffel: "A", display_name: "Löwen" })).toBe("Liga 1 · Staffel A");
  expect(historyMovement("promotion")).toEqual({ label: "Aufstieg", direction: "up" });
  expect(historyMovement("relegation")).toEqual({ label: "Abstieg", direction: "down" });
  expect(historyMovement("playoff_relegation")).toEqual({ label: "Relegation gegen den Abstieg", direction: null });
  expect(historyMovement(null)).toBeNull();
});

test("Staffel auf der Ligaseite: Abrufpfad nur aus einem gültigen Pfad der Season, Meister nur mit Endstand", () => {
  expect(staffelApiPath("/liga/cod/season-1", "t1")).toBe("/leagues/cod/season-1/staffeln/t1");
  expect(staffelApiPath("/liga/cod", "t1")).toBeNull();
  expect(staffelApiPath("https://x.test/liga/a/b", "t1")).toBeNull();
  expect(staffelApiPath(null, "t1")).toBeNull();
  expect(staffelApiPath("/liga/a/b", null)).toBeNull();
  expect(staffelApiPath("/liga/../admin", "t1")).toBeNull();
  expect(staffelApiPath("/liga/cod/.", "t1")).toBeNull();
  expect(staffelApiPath("/liga/cod/season-1", "..")).toBeNull();
  expect(winnerLabel(false)).toBe("Champion");
  expect(winnerLabel(true, { display_name: "Löwen" })).toBe("Meister");
  expect(winnerLabel(true, null)).toBe("Platz 1");
});

test("Nachmeldung (#2422): „Nachgemeldet ab Woche X“, ohne Woche nur „Nachgemeldet“, ohne Feld nichts", () => {
  expect(lateEntryText({ late_entry: true, late_from_week: 3 })).toBe("Nachgemeldet ab Woche 3");
  expect(lateEntryText({ late_entry: true })).toBe("Nachgemeldet");
  expect(lateEntryText({ late_entry: true, late_from_week: 0 })).toBe("Nachgemeldet");
  expect(lateEntryText({ late_entry: true, late_from_week: "x" })).toBe("Nachgemeldet");
  expect(lateEntryText({ late_entry: false, late_from_week: 3 })).toBe("");
  expect(lateEntryText({})).toBe("");
  expect(lateEntryText(null)).toBe("");
});
