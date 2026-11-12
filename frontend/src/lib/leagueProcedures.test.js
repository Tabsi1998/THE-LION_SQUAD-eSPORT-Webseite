import { describe, expect, it } from "vitest";
import { claimedText, deadlineTone, decisionText, procedurePayload, remainingText } from "./leagueProcedures";
import { standingNotes } from "./leagueTable";

const NOW = new Date("2026-11-11T12:00:00Z").getTime();
const GUIDE = {
  reasons: [
    { key: "wrong_result", label: "Falsches Ergebnis", ask_notified: false },
    { key: "equipment", label: "Ausrüstung", ask_notified: true },
    { key: "other", label: "Sonstiges", ask_notified: false },
  ],
  result_reason: "wrong_result", reason_min: 10,
};
const SIDES = ["reg-a", "reg-b"];
const TEXT = "Die zweite Map wurde falsch gemeldet.";

describe("Fristen der Verfahren", () => {
  it("nennt die Restzeit in Tagen, Stunden und Minuten", () => {
    expect(remainingText("2026-11-12T16:00:00Z", NOW)).toBe("noch 1 Tag 4 Std.");
    expect(remainingText("2026-11-14T12:00:00Z", NOW)).toBe("noch 3 Tage");
    expect(remainingText("2026-11-11T14:30:00Z", NOW)).toBe("noch 2 Std. 30 Min.");
    expect(remainingText("2026-11-11T12:00:20Z", NOW)).toBe("noch 1 Min.");
    expect(remainingText("2026-11-11T11:59:00Z", NOW)).toBe("abgelaufen");
    expect(remainingText(null, NOW)).toBeNull();
  });

  it("färbt eine Frist erst kurz vor dem Ende", () => {
    expect(deadlineTone("2026-11-12T12:00:00Z", NOW)).toBe("calm");
    expect(deadlineTone("2026-11-11T17:00:00Z", NOW)).toBe("soon");
    expect(deadlineTone("2026-11-11T11:00:00Z", NOW)).toBe("over");
    expect(deadlineTone(null, NOW)).toBe("none");
  });
});

describe("Geführtes Formular", () => {
  it("verlangt Grund und eine Begründung mit zehn Zeichen", () => {
    expect(procedurePayload({ reasonKey: "", text: TEXT }, GUIDE, SIDES).error).toMatch(/antippen/);
    expect(procedurePayload({ reasonKey: "other", text: "zu kurz" }, GUIDE, SIDES).error).toMatch(/mindestens 10 Zeichen/);
    expect(procedurePayload({ reasonKey: "other", text: TEXT }, GUIDE, SIDES)).toEqual({ payload: { reason: TEXT, reason_key: "other" } });
  });

  it("verlangt bei „Falsches Ergebnis“ das abweichende Ergebnis - sonst bleibt es freiwillig", () => {
    expect(procedurePayload({ reasonKey: "wrong_result", text: TEXT, scores: {} }, GUIDE, SIDES).error).toMatch(/Ergebnis angeben/);
    expect(procedurePayload({ reasonKey: "wrong_result", text: TEXT, scores: { "reg-a": "1" } }, GUIDE, SIDES).error).toMatch(/je Seite eine Zahl/);
    expect(procedurePayload({ reasonKey: "wrong_result", text: TEXT, scores: { "reg-a": "1", "reg-b": "2" } }, GUIDE, SIDES).payload.claimed)
      .toEqual({ results: [{ registration_id: "reg-a", score: 1 }, { registration_id: "reg-b", score: 2 }] });
    expect(procedurePayload({ reasonKey: "other", text: TEXT, scores: {} }, GUIDE, SIDES).payload.claimed).toBeUndefined();
  });

  it("stellt bei Ausrüstung die Pflichtfrage „sofort hingewiesen?“", () => {
    expect(procedurePayload({ reasonKey: "equipment", text: TEXT, notified: null }, GUIDE, SIDES).error).toMatch(/sofort/);
    expect(procedurePayload({ reasonKey: "equipment", text: TEXT, notified: false, incidentId: "v-1" }, GUIDE, SIDES).payload)
      .toEqual({ reason: TEXT, reason_key: "equipment", notified_immediately: false, incident_id: "v-1" });
    expect(procedurePayload({ reasonKey: "other", text: TEXT, notified: true }, GUIDE, SIDES).payload.notified_immediately).toBeUndefined();
  });
});

describe("Texte", () => {
  it("sagt die Entscheidung in einem Satz", () => {
    expect(decisionText({ state: "open" })).toBe("");
    expect(decisionText({ state: "decided", kind: "protest", decision: "keep" })).toBe("Das Ergebnis bleibt.");
    expect(decisionText({ state: "decided", kind: "protest", decision: "change" })).toBe("Das Ergebnis wurde geändert.");
    expect(decisionText({ state: "decided", kind: "appeal", decision: "keep" })).toMatch(/abgewiesen/);
    expect(decisionText({ state: "withdrawn" })).toMatch(/Zurückgezogen/);
  });

  it("schreibt das abweichende Ergebnis mit den Namen der Seiten", () => {
    const claimed = { results: [{ registration_id: "reg-a", score: 1 }, { registration_id: "reg-b", score: 2 }] };
    expect(claimedText(claimed, { "reg-a": "Rudel A", "reg-b": "Horst" })).toBe("Rudel A 1 : 2 Horst");
    expect(claimedText(null)).toBe("");
  });

  it("markiert in der Tabelle angefochtene Ergebnisse - und nur die", () => {
    expect(standingNotes({ contested: 2 }).map((note) => note.text)).toEqual(["2 Spiele in Klärung"]);
    expect(standingNotes({ contested: 1 })[0].text).toBe("1 Spiel in Klärung");
    expect(standingNotes({ contested: 0 })).toEqual([]);
  });
});
