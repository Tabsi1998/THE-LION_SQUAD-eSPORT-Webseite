import { claimedText, decisionText, incidentLabel, procedurePayload, remainingText, type ProcedureForm } from "./leagueProcedures";

// Verfahren (E.2, #1619; App #2173): dieselben Sätze und dieselbe Anfrage wie frontend/src/lib/leagueProcedures.js. Erfundene Namen.

const GUIDE = {
  reasons: [{ key: "wrong_result", label: "Falsches Ergebnis" }, { key: "equipment", label: "Ausrüstung", ask_notified: true }, { key: "conduct", label: "Verhalten" }],
  result_reason: "wrong_result", reason_min: 10,
};
const EMPTY: ProcedureForm = { reasonKey: "", text: "", notified: null, scores: {}, incidentId: "" };

test("geführtes Formular: Grund, Begründung, Ergebnis aus eurer Sicht, Pflichtfrage, Vorfall", () => {
  expect(procedurePayload(EMPTY, GUIDE, ["a", "b"]).error).toBe("Bitte antippen, worum es geht.");
  expect(procedurePayload({ ...EMPTY, reasonKey: "conduct", text: "zu kurz" }, GUIDE, ["a", "b"]).error).toBe("Bitte beschreibe in mindestens 10 Zeichen, was nicht stimmt.");
  expect(procedurePayload({ ...EMPTY, reasonKey: "wrong_result", text: "Map 2 ging an uns" }, GUIDE, ["a", "b"]).error).toContain("je Seite eine Zahl");
  expect(procedurePayload({ ...EMPTY, reasonKey: "wrong_result", text: "Map 2 ging an uns", scores: { a: "2", b: "1" } }, GUIDE, ["a", "b"]).payload)
    .toEqual({ reason: "Map 2 ging an uns", reason_key: "wrong_result", claimed: { results: [{ registration_id: "a", score: 2 }, { registration_id: "b", score: 1 }] } });
  expect(procedurePayload({ ...EMPTY, reasonKey: "equipment", text: "Verbotene Waffe genutzt" }, GUIDE, ["a", "b"]).error).toContain("sofort darauf hingewiesen");
  expect(procedurePayload({ ...EMPTY, reasonKey: "equipment", text: "Verbotene Waffe genutzt", notified: false, incidentId: "i1" }, GUIDE, ["a", "b"]).payload)
    .toEqual({ reason: "Verbotene Waffe genutzt", reason_key: "equipment", notified_immediately: false, incident_id: "i1" });
});

test("Sätze: Restzeit, Entscheid, abweichendes Ergebnis, Vorfall", () => {
  const now = Date.parse("2026-11-20T12:00:00Z");
  expect(remainingText("2026-11-21T16:30:00Z", now)).toBe("noch 1 Tag 4 Std.");
  expect(remainingText("2026-11-20T12:35:00Z", now)).toBe("noch 35 Min.");
  expect(remainingText("2026-11-20T11:00:00Z", now)).toBe("abgelaufen");
  expect(remainingText(null, now)).toBeNull();
  expect(decisionText({ state: "decided", kind: "protest", decision: "keep" })).toBe("Das Ergebnis bleibt.");
  expect(decisionText({ state: "decided", kind: "appeal", decision: "change" })).toBe("Dem Einspruch wurde stattgegeben.");
  expect(decisionText({ state: "open" })).toBe("");
  expect(claimedText({ results: [{ registration_id: "a", score: 1 }, { registration_id: "b", score: 2 }] }, { a: "Rudel A", b: "Horst" })).toBe("Rudel A 1 : 2 Horst");
  expect(incidentLabel({ position: 2, kind: "rehost" })).toBe("Map 2: Rehost");
});
