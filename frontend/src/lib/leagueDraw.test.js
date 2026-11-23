import { describe, expect, test } from "vitest";
import { drawLogLine, drawStatusLine, drawVisible, staffelnLine, swapPartners, waitingLine } from "./leagueDraw";

const division = (extra = {}) => ({
  id: "d1", label: "Liga 1", waiting: [], suggestion: { teams: 0, fits: true, text: "" }, problem: null, can_draw: false, draw: null,
  staffeln: [{ tournament_id: "t1", staffel: "A", seats: 0, max_participants: 8 }, { tournament_id: "t2", staffel: "B", seats: 0, max_participants: 8 }],
  ...extra,
});

describe("Los auf mehrere Staffeln", () => {
  test("wer wartet, in Ein- und Mehrzahl", () => {
    expect(waitingLine({ waiting: [{}] })).toBe("1 Co-Team wartet auf eine Staffel");
    expect(waitingLine({ waiting: [{}, {}, {}] })).toBe("3 Co-Teams warten auf eine Staffel");
    expect(waitingLine({ waiting: [] })).toBe("Kein Co-Team wartet auf eine Staffel");
  });

  test("die Staffeln mit ihren Plätzen", () => {
    expect(staffelnLine(division().staffeln)).toBe("Staffel A 0 von 8 · Staffel B 0 von 8");
    expect(staffelnLine([])).toBe("Noch keine Staffel");
  });

  test("das Panel erscheint nur, wenn es etwas zu losen, zu prüfen oder nachzulesen gibt", () => {
    expect(drawVisible({ divisions: [division()] })).toBe(false);
    expect(drawVisible({ divisions: [division({ waiting: [{}] })] })).toBe(true);
    expect(drawVisible({ divisions: [division({ draw: { status: "applied" } })] })).toBe(true);
    // Eine Staffel, in die alle passen: Zugeteilt wird im Eingang, das Panel bleibt weg.
    const single = division({ staffeln: [{ tournament_id: "t1", staffel: "A", seats: 0, max_participants: 8 }], waiting: [{}, {}], suggestion: { teams: 2, fits: true } });
    expect(drawVisible({ divisions: [single] })).toBe(false);
    // Passen sie nicht, sagt es die Platzprüfung - auch mit nur einer Staffel.
    expect(drawVisible({ divisions: [{ ...single, suggestion: { teams: 9, fits: false } }] })).toBe(true);
    expect(drawVisible(null)).toBe(false);
  });

  test("der Stand eines Loses in einem Satz", () => {
    expect(drawStatusLine({ status: "draft", number: 1, stale: false })).toBe("Los Nr. 1 – Vorschau, noch nicht übernommen");
    expect(drawStatusLine({ status: "draft", number: 2, stale: true })).toBe("Los Nr. 2 – veraltet: Seitdem hat sich etwas geändert");
    expect(drawStatusLine({ status: "applied", number: 2, applied_at: "2026-11-23T13:05:00+00:00" })).toBe("Los Nr. 2 – übernommen am 23.11.2026, 14:05");
  });

  test("das Protokoll nennt Schritt, Person und Grund", () => {
    const at = "2026-11-23T13:05:00+00:00";
    expect(drawLogLine({ action: "create", number: 1, by_name: "Probe Leitung", at })).toBe("23.11.2026, 14:05: Ausgelost (Los Nr. 1), Probe Leitung");
    expect(drawLogLine({ action: "redraw", number: 2, by_name: "Probe Leitung", at, reason: "Falsche Staffelzahl" }))
      .toBe("23.11.2026, 14:05: Neu ausgelost (Los Nr. 2), Probe Leitung, Grund: Falsche Staffelzahl");
    expect(drawLogLine({ action: "redraw", number: 2, by_name: "Probe Leitung", at, stale: true }))
      .toBe("23.11.2026, 14:05: Neu ausgelost (Los Nr. 2), Probe Leitung, weil sich die Eingabe geändert hatte");
    expect(drawLogLine({ action: "swap", by_name: "Probe Leitung", at, reason: "Terminwunsch" })).toBe("23.11.2026, 14:05: Getauscht, Probe Leitung, Grund: Terminwunsch");
    expect(drawLogLine({ action: "apply", by_name: "Probe Chef", at, conflict_reason: "Niemand sonst da" }))
      .toBe("23.11.2026, 14:05: Übernommen, Probe Chef (Notausnahme: Niemand sonst da)");
  });

  test("getauscht wird nur mit Co-Teams aus anderen Staffeln", () => {
    const draw = { staffeln: [
      { tournament_id: "t1", staffel: "A", teams: [{ squad_id: "s1", display_name: "Probe Eins" }, { squad_id: "s2", display_name: "Probe Zwei" }] },
      { tournament_id: "t2", staffel: "B", teams: [{ squad_id: "s3", display_name: "Probe Drei" }] },
    ] };
    expect(swapPartners(draw, "s1")).toEqual([["s3", "Probe Drei · Staffel B"]]);
    expect(swapPartners(draw, "s3")).toEqual([["s1", "Probe Eins · Staffel A"], ["s2", "Probe Zwei · Staffel A"]]);
    expect(swapPartners(draw, "fremd")).toEqual([]);
  });
});
