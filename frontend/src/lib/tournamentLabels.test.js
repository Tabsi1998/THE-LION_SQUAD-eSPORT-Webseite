import { describe, expect, it } from "vitest";

import { formatBracketSection } from "./tournamentLabels";

describe("formatBracketSection", () => {
  it("nutzt die eingefuehrten eSports-Begriffe statt Uebersetzungen", () => {
    expect(formatBracketSection("WB")).toBe("Winner Bracket");
    expect(formatBracketSection("LB")).toBe("Loser Bracket");
    expect(formatBracketSection("GF")).toBe("Grand Final");
    expect(formatBracketSection("winner")).toBe("Winner Bracket");
    expect(formatBracketSection("loser")).toBe("Loser Bracket");
  });

  it("beschriftet Round Robin als Spieltage statt als Gruppe", () => {
    expect(formatBracketSection("round_robin")).toBe("Spieltage");
    expect(formatBracketSection("LIGA")).toBe("Spieltage");
  });

  it("übersetzt die Gruppenabschnitte, statt group_A anzuzeigen", () => {
    // group_A ist der Name, unter dem die Gruppentabelle ihre Spiele findet -
    // sehen soll ihn niemand.
    expect(formatBracketSection("group_A")).toBe("Gruppe A");
    expect(formatBracketSection("group_b")).toBe("Gruppe B");
    expect(formatBracketSection("group_12")).toBe("Gruppe 12");
  });

  it("benennt Liga und Schweizer System", () => {
    expect(formatBracketSection("LIGA")).toBe("Spieltage");
    expect(formatBracketSection("swiss")).toBe("Schweizer Runden");
  });

  it("zeigt Unbekanntes unverändert statt es zu verschlucken", () => {
    expect(formatBracketSection("EIGENER_ABSCHNITT")).toBe("EIGENER_ABSCHNITT");
    expect(formatBracketSection("")).toBe("Turnierbaum");
    expect(formatBracketSection(null)).toBe("Turnierbaum");
  });

  it("verwechselt ähnliche Namen nicht mit Gruppen", () => {
    expect(formatBracketSection("group")).toBe("group");
    expect(formatBracketSection("group_")).toBe("group_");
  });
});
