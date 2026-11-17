import { gameChips, gameScore, gameState, gamesByWeek, matchdayOf, weekWarnText } from "./staffelGames";

// Reiter „Spiele und Ergebnisse“ der Staffel-Seite (#2262, Paket B): Spiele je Spielwoche mit Stand, Ergebnis und den Chips aus
// `league_marks` (Server, nur gelesen). Erfundene Werte.

const slots = [{ slot: 1, registration_id: "r1" }, { slot: 2, registration_id: "r2" }];
const game = (fields = {}) => ({ id: "m1", status: "scheduled", matchday_number: 1, slots, ...fields });

describe("Spielwoche", () => {
  it("liest die Woche aus matchday_number, round oder round_index - wie der Server", () => {
    expect(matchdayOf({ matchday_number: 3 })).toBe(3);
    expect(matchdayOf({ round: "2" })).toBe(2);
    expect(matchdayOf({ round_index: 4 })).toBe(4);
    expect(matchdayOf({ round: 0 })).toBeNull();
  });

  it("ordnet echte Spiele nach Woche, ohne Vorschau und Abgesagtes, ohne Woche am Ende", () => {
    const weeks = gamesByWeek([
      game({ id: "a", matchday_number: 2 }), game({ id: "b", matchday_number: 1 }), game({ id: "c", matchday_number: 2 }),
      game({ id: "p", is_preview: true }), game({ id: "x", status: "cancelled" }), game({ id: "n", matchday_number: null, round: null }),
    ]);
    expect(weeks.map((week) => [week.number, week.matches.map((match) => match.id)])).toEqual([[1, ["b"]], [2, ["a", "c"]], [null, ["n"]]]);
  });
});

describe("Stand und Ergebnis", () => {
  it("nennt jeden Stand in Liga-Wörtern", () => {
    expect(gameState(game({ scheduled_at: null })).text).toBe("Termin offen");
    expect(gameState(game({ scheduled_at: "2026-11-20T18:00:00Z" })).text).toBe("Geplant");
    expect(gameState(game({ status: "in_progress" })).text).toBe("Läuft");
    expect(gameState(game({ status: "in_progress", reports: [{ registration_id: "r1" }] })).text).toBe("Meldung liegt vor");
    expect(gameState(game({ status: "completed" }))).toEqual({ tone: "done", text: "Gespielt" });
    expect(gameState(game({ status: "forfeit" })).text).toBe("Kampflos gewertet");
    expect(gameState(game({ status: "forfeit", double_forfeit: true })).text).toBe("Beide nicht erschienen");
    expect(gameState(game({ status: "disputed" })).tone).toBe("warn");
  });

  it("zeigt das Ergebnis in Platzreihenfolge, kampflos markiert", () => {
    const results = [{ registration_id: "r2", score: 1, rank: 2 }, { registration_id: "r1", score: 2, rank: 1 }];
    expect(gameScore(game({ status: "completed", results }))).toEqual({ text: "2 : 1", winner: "r1" });
    const forfeit = [{ registration_id: "r1", score: 0, rank: 2, forfeit: true }, { registration_id: "r2", score: 3, rank: 1 }];
    expect(gameScore(game({ status: "forfeit", results: forfeit }))).toEqual({ text: "0 : 3", winner: "r2" });
    expect(gameScore(game({ status: "forfeit", double_forfeit: true, results: [] }))).toEqual({ text: "", winner: null });
    expect(gameScore(game())).toEqual({ text: "", winner: null });
  });
});

describe("Chips aus league_marks", () => {
  it("ohne Kennzeichen keine Chips", () => {
    expect(gameChips(game())).toEqual([]);
    expect(gameChips(game({ league_marks: { checkin: "none", checked_in: 0, veto: null, incidents: 0, procedures: 0 } }))).toEqual([]);
  });

  it("Check-in, Veto, Vorfall und Verfahren - nur was gerade zählt", () => {
    const chips = gameChips(game({ league_marks: { checkin: "open", checked_in: 1, veto: null, incidents: 2, procedures: 1 } }));
    expect(chips.map((chip) => [chip.key, chip.text, chip.tone])).toEqual([
      ["checkin", "Check-in 1 von 2", "info"], ["incidents", "2 Vorfälle offen", "warn"], ["procedures", "Verfahren offen", "warn"],
    ]);
    expect(gameChips(game({ league_marks: { checkin: "closed", checked_in: 1 } }))[0]).toMatchObject({ text: "Check-in verpasst · 1 von 2", tone: "warn" });
    expect(gameChips(game({ league_marks: { checkin: "ready", checked_in: 2 } }))[0]).toMatchObject({ text: "Beide eingecheckt", tone: "ok" });
    expect(gameChips(game({ league_marks: { checkin: "veto", checked_in: 2 } })).map((chip) => chip.text)).toEqual(["Beide eingecheckt", "Veto steht an"]);
    expect(gameChips(game({ league_marks: { checkin: "running", veto: "running" } })).map((chip) => chip.text)).toEqual(["Veto läuft"]);
    expect(gameChips(game({ league_marks: { checkin: "running", veto: "paused" } }))[0]).toMatchObject({ text: "Veto pausiert", tone: "warn" });
    expect(gameChips(game({ league_marks: { checkin: "finished", veto: "done", incidents: 0, procedures: 2 } })).map((chip) => chip.text)).toEqual(["2 Verfahren offen"]);
  });
});

describe("offene Punkte im Kopf der Woche", () => {
  const marks = (fields) => game({ league_marks: { checkin: "none", checked_in: 0, veto: null, incidents: 0, procedures: 0, ...fields } });
  it("nennt die Art, wenn nur eine vorkommt - mit Zahl und Mehrzahl", () => {
    expect(weekWarnText([marks({ procedures: 1 })])).toBe("1 Verfahren offen");
    expect(weekWarnText([marks({ procedures: 1 }), marks({ procedures: 2 })])).toBe("3 Verfahren offen");
    expect(weekWarnText([marks({ incidents: 1 })])).toBe("1 Vorfall offen");
    expect(weekWarnText([marks({ incidents: 2 })])).toBe("2 Vorfälle offen");
    expect(weekWarnText([marks({ checkin: "closed", checked_in: 1 })])).toBe("1 Check-in verpasst");
    expect(weekWarnText([marks({ checkin: "closed" }), marks({ checkin: "closed" })])).toBe("2 Check-ins verpasst");
    expect(weekWarnText([marks({ checkin: "running", veto: "paused" })])).toBe("1 Veto pausiert");
  });
  it("gemischt: „N offene Punkte“, ohne Warnung leer", () => {
    expect(weekWarnText([marks({ procedures: 1, incidents: 1 })])).toBe("2 offene Punkte");
    expect(weekWarnText([marks({ procedures: 2 }), marks({ checkin: "closed" })])).toBe("3 offene Punkte");
    expect(weekWarnText([marks({ checkin: "open", checked_in: 1 }), game()])).toBe("");
  });
});
