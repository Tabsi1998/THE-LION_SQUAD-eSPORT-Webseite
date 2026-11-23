import { describe, expect, test } from "vitest";
import { candidateLine, candidateState, crossDecisionLine, crossStatus, decisionReady, perGame, sideTitle, signedPerGame, tieLine } from "./leagueCrossZones";

describe("Plätze über Staffeln hinweg (#1627)", () => {
  test("Schnitt je Spiel mit Komma und Vorzeichen", () => {
    expect(perGame(2)).toBe("2,00");
    expect(perGame(1.5)).toBe("1,50");
    expect(signedPerGame(0.667)).toBe("+0,67");
    expect(signedPerGame(-0.5)).toBe("−0,50");
    expect(signedPerGame(0)).toBe("0,00");
    expect(signedPerGame(-0.001)).toBe("0,00");
  });

  test("ein Kandidat mit Herkunft und Vergleichswerten", () => {
    expect(candidateLine({ staffel: "A", rank: 2, points_per_game: 2, map_diff_per_game: 0.667 }))
      .toBe("Staffel A, Platz 2 · 2,00 Punkte je Spiel · +0,67 Maps je Spiel");
  });

  test("das Etikett sagt, ob jemand auf- bzw. absteigt oder im Gleichstand steht", () => {
    expect(candidateState({ kind: "promote_best" }, { chosen: true })).toEqual({ key: "chosen", label: "steigt auf" });
    expect(candidateState({ kind: "relegate_worst" }, { chosen: true })).toEqual({ key: "chosen", label: "steigt ab" });
    expect(candidateState({ kind: "promote_best" }, { chosen: false, tied: true })).toEqual({ key: "tied", label: "Gleichstand" });
    expect(candidateState({ kind: "promote_best" }, { chosen: false, tied: false })).toBeNull();
  });

  test("Überschrift, Stand und Sätze", () => {
    expect(sideTitle({ label: "Aufstieg über den Vergleich der Staffeln", count: 1 })).toBe("Aufstieg über den Vergleich der Staffeln · 1 Platz");
    expect(sideTitle({ label: "Abstieg über den Vergleich der Staffeln", count: 2 })).toBe("Abstieg über den Vergleich der Staffeln · 2 Plätze");
    expect(crossStatus({ final: true })).toContain("Das gilt für die neue Season");
    expect(crossStatus({ final: false })).toContain("Stand von jetzt");
    expect(tieLine({ open: 1, names: ["Probe Rot", "Probe Blau"] }))
      .toBe("Gleichstand nach Punkten je Spiel und Map-Differenz je Spiel: Probe Rot – Probe Blau. Nur einer bekommt den Platz.");
    expect(tieLine({ open: 2, names: ["A", "B", "C"] })).toContain("Nur 2 bekommen den Platz.");
    expect(crossDecisionLine({ names: ["Probe Blau"], method_label: "Entscheidungsspiel", reason: "3:1 gewonnen" })).toBe("Probe Blau – Entscheidungsspiel: 3:1 gewonnen");
  });

  test("der Entscheid geht erst mit genau so vielen Teams wie offen, Art und Grund", () => {
    const tie = { open: 1 };
    expect(decisionReady(tie, ["r1"], "playoff", "3:1 gewonnen")).toBe(true);
    expect(decisionReady(tie, [], "playoff", "3:1 gewonnen")).toBe(false);
    expect(decisionReady(tie, ["r1", "r2"], "playoff", "3:1 gewonnen")).toBe(false);
    expect(decisionReady(tie, ["r1"], "", "3:1 gewonnen")).toBe(false);
    expect(decisionReady(tie, ["r1"], "lead", "ja")).toBe(false);
    expect(decisionReady(null, ["r1"], "lead", "Grund genug")).toBe(false);
  });
});
