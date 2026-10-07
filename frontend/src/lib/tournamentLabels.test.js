import { describe, expect, it } from "vitest";

import { BYE_LABEL, OPEN_SLOT_LABEL, finishedMatchText, formatBracketSection, isByeSlot, matchHeadline, slotName, stationText } from "./tournamentLabels";

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

// Klartext auf Turnier- und Matchseiten (#1220): Freilos heißt Freilos, leere Plätze vor der Auslosung „noch offen“,
// die Station einmal im Klartext, ein fertiges Spiel nennt sein Ergebnis.
describe("Klartext für Plätze, Station und Ergebnis", () => {
  const bye = { status: "completed", winner_id: "r1" };

  it("erkennt ein Freilos am Platz, an der Herkunft und an einem leeren Platz im entschiedenen Spiel", () => {
    expect(isByeSlot({ status: "bye" })).toBe(true);
    expect(isByeSlot({ status: "walkover" })).toBe(true);
    expect(isByeSlot({ source: { type: "bye" } })).toBe(true);
    expect(isByeSlot({ registration_id: null, status: "pending" }, bye)).toBe(true);
    expect(isByeSlot({ registration_id: "r1", status: "filled" }, bye)).toBe(false);
    expect(isByeSlot({ registration_id: null, status: "pending" }, { status: "scheduled" })).toBe(false);
  });

  it("benennt leere Plätze: Freilos oder noch offen - nie „Offen“", () => {
    expect(slotName("NeonFalke", { status: "filled" })).toBe("NeonFalke");
    expect(slotName("", { status: "bye" })).toBe(BYE_LABEL);
    expect(slotName(null, { status: "pending" }, { status: "scheduled" })).toBe(OPEN_SLOT_LABEL);
    expect(OPEN_SLOT_LABEL).toBe("noch offen");
  });

  it("baut die Überschrift aus den Namen", () => {
    const duel = [{ registration_id: "r1", display_name: "NeonFalke", status: "filled" }, { registration_id: "r2", display_name: "LunaByte", status: "filled" }];
    expect(matchHeadline(duel, { status: "completed" })).toBe("NeonFalke gegen LunaByte");
    expect(matchHeadline([duel[0], { slot: 2, status: "bye" }], bye)).toBe("NeonFalke gegen Freilos");
    expect(matchHeadline([{ status: "pending" }, { status: "pending" }], { status: "scheduled" })).toBe("noch offen gegen noch offen");
    expect(matchHeadline([...duel, { registration_id: "r3", display_name: "KiwiKomet" }], { match_type: "ffa" })).toBe("Heat mit 3 Plätzen");
  });

  it("sagt, wie ein fertiges Spiel ausgegangen ist", () => {
    const duel = [{ registration_id: "r1", display_name: "NeonFalke" }, { registration_id: "r2", display_name: "LunaByte" }];
    expect(finishedMatchText([duel[0], { status: "bye" }], bye)).toBe("Freilos – NeonFalke kommt kampflos weiter.");
    expect(finishedMatchText(duel, { status: "completed", winner_id: "r2", results: [{ registration_id: "r1", score: 1 }, { registration_id: "r2", score: 3 }] })).toBe("LunaByte gewinnt 3:1.");
    expect(finishedMatchText(duel, { status: "completed", winner_id: "r1", score_a: 2, score_b: 0 })).toBe("NeonFalke gewinnt 2:0.");
    expect(finishedMatchText(duel, { status: "forfeit", winner_id: "r1" })).toBe("NeonFalke gewinnt durch Wertung.");
    expect(finishedMatchText(duel, { status: "completed", score_a: 2, score_b: 2 })).toBe("Unentschieden 2:2.");
  });

  it("schreibt die Station einmal und im Klartext", () => {
    expect(stationText({ station_text: "Station A · Switch 2", station_label: "Station A - switch2" })).toBe("Station A · Switch 2");
    expect(stationText({ station_text: "" , station_label: "f3c2" })).toBe("");
    expect(stationText({ station_label: "Station A - switch2" })).toBe("Station A · Switch 2");
    expect(stationText({ station_label: "B - pc" })).toBe("Station B · PC");
    expect(stationText({ station_name: "Switch 2 Station 1 - switch2" })).toBe("Switch 2 Station 1");
    expect(stationText({})).toBe("");
  });
});
