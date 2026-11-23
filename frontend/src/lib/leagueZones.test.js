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

  it("Plätze über Staffeln hinweg (#1627): nur da, wenn gesetzt - sonst sieht alles aus wie vorher", () => {
    expect(zonesLine({ promote: 1, relegate: 1, promote_best: 2 })).toBe("1 Aufsteiger · dazu 2 beste Nächstplatzierte über alle Staffeln · 1 Absteiger");
    expect(zonesLine({ promote: 1, relegate: 1, relegate_worst: 1 })).toBe("1 Aufsteiger · 1 Absteiger · dazu 1 schlechtester Platz vor dem Abstieg über alle Staffeln");
    expect(zonesToForm({ promote: 1, relegate: 1, promote_best: 2 })).toEqual({ promote: "1", relegate: "1", playoff_promote: "0", playoff_relegate: "0", promote_best: "2" });
    expect(zonesPayload({ promote: "1", relegate: "1", playoff_promote: "0", playoff_relegate: "0", promote_best: "2", relegate_worst: "" }))
      .toEqual({ promote: 1, relegate: 1, playoff_promote: 0, playoff_relegate: 0, promote_best: 2 });
    // Gegenprobe: 0 heißt „gibt es nicht“ und geht nicht mit.
    expect(zonesPayload({ promote: "1", relegate: "1", promote_best: "0" })).toEqual({ promote: 1, relegate: 1, playoff_promote: 0, playoff_relegate: 0 });
    expect(zonesToForm({ promote: 1, relegate: 1, promote_best: 0 })).toEqual({ promote: "1", relegate: "1", playoff_promote: "0", playoff_relegate: "0" });
  });

  it("macht aus dem Formular ganze Zahlen 0–10, leer heißt Vorgabe", () => {
    expect(zonesToForm(undefined)).toEqual({ promote: "1", relegate: "1", playoff_promote: "0", playoff_relegate: "0" });
    expect(zonesPayload({ promote: "2", relegate: "", playoff_promote: "15", playoff_relegate: "-3" }))
      .toEqual({ promote: 2, relegate: 1, playoff_promote: 10, playoff_relegate: 0 });
  });
});
