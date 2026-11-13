import { describe, expect, it } from "vitest";
import { ZONE_LABELS, zoneLegend, zonesLine, zonesPayload, zonesToForm } from "./leagueTable";

describe("Zonen für Auf- und Abstieg (F.2, #1627)", () => {
  it("zeigt in der Legende nur die Zonen, die in der Tabelle vorkommen - in fester Reihenfolge", () => {
    const rows = [{ zone: "relegation" }, { zone: null }, { zone: "promotion" }, { zone: "out" }];
    expect(zoneLegend(rows)).toEqual([{ zone: "promotion", label: ZONE_LABELS.promotion }, { zone: "relegation", label: ZONE_LABELS.relegation }]);
    expect(zoneLegend([{ zone: null }])).toEqual([]);
  });

  it("beschreibt die Zonen einer Liga N mit den Randfällen", () => {
    expect(zonesLine({ promote: 1, relegate: 1 })).toBe("1 Aufsteiger · 1 Absteiger");
    expect(zonesLine({ promote: 0, relegate: 2, top: true })).toBe("oberste Liga: kein Aufstieg · 2 Absteiger");
    expect(zonesLine({ promote: 2, relegate: 0, playoff_promote: 1, bottom: true })).toBe("2 Aufsteiger · 1 Relegation oben · unterste Liga: kein Abstieg");
    expect(zonesLine(null)).toBe("");
  });

  it("macht aus dem Formular ganze Zahlen 0–10, leer heißt Vorgabe", () => {
    expect(zonesToForm(undefined)).toEqual({ promote: "1", relegate: "1", playoff_promote: "0", playoff_relegate: "0" });
    expect(zonesPayload({ promote: "2", relegate: "", playoff_promote: "15", playoff_relegate: "-3" }))
      .toEqual({ promote: 2, relegate: 1, playoff_promote: 10, playoff_relegate: 0 });
  });
});
