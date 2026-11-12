import {
  PAUSE_BETWEEN, canSettleAtOnce, clockOffset, closeProblem, countsQuota, decisionProblem, emptyIncidentForm, holdNotice, incidentPayload,
  incidentProblem, mapStateNotes, positionLabel, pulsingIncidentId, quotaHint, quotaText, remainingMs, remainingShare, remainingText, scoreText,
  settleProblem, settleSentence, sortedIncidents, stateSentence,
} from "./leagueIncidents";

// Vorfälle im Spiel (D.5, #1619): Sätze, Prüfung und Anfrage des Formulars. Erfundene Namen.

const SIDES = [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }];
const INFO = { break_minutes: 5, quota: { limit: 1, used: [{ registration_id: "a", position: 2, count: 1 }] } };

test("die Restzeit rechnet mit der Serverzeit und wird nie negativ", () => {
  const now = Date.parse("2026-11-11T20:00:00Z");
  expect(clockOffset("2026-11-11T20:00:30Z", now)).toBe(30000);
  expect(clockOffset("", now)).toBe(0);
  expect(remainingMs("2026-11-11T20:05:00Z", now)).toBe(300000);
  expect(remainingMs("2026-11-11T20:05:00Z", now, 30000)).toBe(270000);
  expect(remainingMs("2026-11-11T19:59:00Z", now)).toBe(0);
  expect(remainingText(247000)).toBe("4:07");
  expect(remainingText(0)).toBe("0:00");
  const incident = { at: "2026-11-11T20:00:00Z", answer_deadline: "2026-11-11T20:10:00Z" };
  expect(remainingShare(incident, now)).toBe(1);
  expect(remainingShare(incident, now + 300000)).toBe(0.5);
  expect(remainingShare(incident, now + 900000)).toBe(0);
  expect(remainingShare({}, now)).toBe(0);
});

test("Stand, Map und Kontingent stehen im Klartext", () => {
  expect(scoreText({ a: 3, b: 4 }, SIDES)).toBe("3:4");
  expect(scoreText(null, SIDES)).toBe("");
  expect(scoreText({ a: 3 }, SIDES)).toBe("");
  expect(positionLabel({ planned_games: [{ position: 2, map_name: "Turm" }] }, 2)).toBe("Map 2 · Turm");
  expect(positionLabel({}, 3)).toBe("Map 3");
  expect(quotaText(INFO, "a", 2)).toBe("1 von 1 genutzt");
  expect(quotaText(INFO, "b", 2)).toBe("0 von 1 genutzt");
  expect(countsQuota("rehost") && countsQuota("pause")).toBe(true);
  expect(["moss_crash", "disconnect", "replay", PAUSE_BETWEEN].some(countsQuota)).toBe(false);
});

test("über dem Kontingent bleibt die Meldung möglich - der Hinweis sagt, was dann gilt", () => {
  expect(quotaHint(INFO, "b", 2, "rehost")).toBe("Zählt gegen euer Kontingent auf dieser Map: bisher 0 von 1 genutzt.");
  expect(quotaHint(INFO, "a", 2, "pause")).toContain("Ihr könnt trotzdem melden");
  expect(quotaHint(INFO, "a", 2, "moss_crash")).toBe("");
  expect(quotaHint(INFO, null, 2, "rehost")).toBe("");
});

test("öffentlich steht nur „in Klärung“ oder „zählt nicht“", () => {
  const league = { map_state: [{ position: 1, state: "played" }, { position: 2, state: "in_clarification" }, { position: 3, state: "open", surplus: true },
    { position: 4, state: "replayed" }] };
  expect(mapStateNotes(league)).toEqual([
    { position: 2, kind: "clarification", text: "Map 2 ist in Klärung" },
    { position: 3, kind: "surplus", text: "Map 3 zählt nicht (Entscheidung der Liga-Leitung)" },
  ]);
  expect(mapStateNotes({})).toEqual([]);
});

test("je Stand ein Satz, der sagt, wer dran ist - ohne Uhrzeit, die steht nur am Countdown", () => {
  const base = { answer_deadline: "2026-11-11T19:10:00Z", proposal_label: "Map wiederholen" };
  // Wer antworten muss, wer gemeldet hat, wer nur zusieht.
  expect(stateSentence({ ...base, state: "proposed", can_answer: true })).toBe("Ihr seid dran: stimmt zu oder lehnt ab.");
  expect(stateSentence({ ...base, state: "proposed", reported_by: { own: true } })).toBe("Die Gegenseite antwortet noch.");
  expect(stateSentence({ ...base, state: "proposed", reported_by: { own: false } }, { ownSide: true })).toBe("Euer Captain oder Vertreter ist dran: zustimmen oder ablehnen.");
  expect(stateSentence({ ...base, state: "proposed" }, { otherName: "Horst" })).toBe("Horst antwortet noch.");
  expect(stateSentence({ ...base, state: "proposed", expired: true })).toContain("geht an die Liga-Leitung");
  for (const row of [{ can_answer: true }, { reported_by: { own: true } }, {}]) {
    expect(stateSentence({ ...base, state: "proposed", ...row })).not.toMatch(/\d\d:\d\d/);
  }
  expect(stateSentence({ ...base, state: "agreed" })).toBe("Beide Seiten sind sich einig: Map wiederholen.");
  expect(stateSentence({ state: "decided", decision: { outcome_label: "Map zugesprochen", awarded_to: "Rudel A" } })).toBe("Entscheidung der Liga-Leitung: Map zugesprochen (Rudel A).");
  expect(stateSentence({ state: "withdrawn" })).toContain("Zurückgezogen");
  expect(stateSentence({ state: "closed", close_reason: "lead" })).toBe("Die Liga-Leitung hat den Vorfall ohne Entscheidung geschlossen.");
  expect(stateSentence({ state: "closed", close_reason: "match_ended" })).toContain("Das Spiel ist zu Ende");
  expect(stateSentence({ between_maps: true, minutes: 7, position: 2, state: "agreed" })).toBe("Pause von 7 Minuten nach Map 2 – nur festgehalten.");
});

test("„In Klärung“ steht nicht im Satz der Karte - nur der Grund und was die Serie solange tut", () => {
  expect(stateSentence({ state: "in_review", review_cause: "rejected" }, { mode: "continue" }))
    .toBe("Die Gegenseite hat abgelehnt. Die Serie läuft unter Vorbehalt weiter, gewertet wird nach der Entscheidung.");
  expect(stateSentence({ state: "in_review", review_cause: "expired" }, { mode: "pause_series" }))
    .toBe("Keine Antwort in der Antwortzeit. Die Serie pausiert: Spätere Maps meldet ihr erst nach der Entscheidung.");
  expect(stateSentence({ state: "in_review", review_cause: "lead" })).toBe("Von der Liga-Leitung aufgenommen.");
  expect(stateSentence({ state: "in_review" })).toBe("");
  for (const cause of ["rejected", "expired", "lead", undefined]) {
    for (const mode of ["continue", "pause_series", ""]) expect(stateSentence({ state: "in_review", review_cause: cause }, { mode })).not.toMatch(/Klärung/i);
  }
});

test("über den Karten steht nur „neu melden“; höchstens ein Abzeichen atmet", () => {
  expect(holdNotice({ hold: { code: "rereport", text: "Map 2 wird wiederholt – danach meldet ihr die Serie neu." } })).toBe("Map 2 wird wiederholt – danach meldet ihr die Serie neu.");
  for (const code of ["in_review", "proposed", "unsettled", "missing"]) expect(holdNotice({ hold: { code, text: "steht an der Karte" } })).toBe("");
  expect(holdNotice({ hold: null })).toBe("");
  expect(holdNotice(null)).toBe("");
  expect(pulsingIncidentId([{ id: "a", state: "proposed" }, { id: "b", state: "in_review" }, { id: "c", state: "in_review" }])).toBe("b");
  expect(pulsingIncidentId([{ id: "a", state: "decided" }])).toBeNull();
  expect(pulsingIncidentId()).toBeNull();
  expect(closeProblem({ reason: "ok" })).toContain("begründen");
  expect(closeProblem({ reason: "Gegner nicht mehr da" })).toBe("");
});

test("die Feststellung der Serie sagt, was fehlt oder nicht zählt", () => {
  expect(settleSentence(null)).toBe("");
  expect(settleSentence({ settled_at: null })).toContain("noch nicht festgestellt");
  expect(settleSentence({ settled_at: "x", missing_positions: [3] })).toBe("Serie festgestellt: Es fehlt noch Map 3.");
  expect(settleSentence({ settled_at: "x", surplus_positions: [3] })).toBe("Serie festgestellt: Map 3 zählt nicht.");
  expect(settleSentence({ settled_at: "x" })).toBe("Serie festgestellt – es fehlt keine Map.");
});

test("das Formular nennt den ersten fehlenden Schritt", () => {
  const form = emptyIncidentForm(INFO);
  expect(form.minutes).toBe("5");
  expect(incidentProblem(form, SIDES)).toContain("welche Map");
  expect(incidentProblem({ ...form, position: 2 }, SIDES)).toContain("was passiert ist");
  expect(incidentProblem({ ...form, position: 2, kind: "disconnect" }, SIDES)).toContain("Vorschlag");
  expect(incidentProblem({ ...form, position: 2, kind: "disconnect", proposal: "replay", scores: { a: "3" } }, SIDES)).toContain("beider Seiten");
  expect(incidentProblem({ ...form, position: 2, kind: "disconnect", proposal: "replay", round: "x" }, SIDES)).toContain("Runde");
  expect(incidentProblem({ ...form, position: 2, kind: "other", proposal: "replay", note: "ab" }, SIDES)).toContain("kurz beschreiben");
  expect(incidentProblem({ ...form, position: 2, kind: "disconnect", proposal: "replay" }, SIDES)).toBe("");
  // Die Map-Pause braucht nur ihre Länge - keinen Vorschlag.
  expect(incidentProblem({ ...form, position: 2, kind: PAUSE_BETWEEN, minutes: "" }, SIDES)).toContain("Länge der Pause");
  expect(incidentProblem({ ...form, position: 2, kind: PAUSE_BETWEEN, minutes: "7" }, SIDES)).toBe("");
});

test("die Anfrage trägt nur, was der Server kennt", () => {
  const form = { ...emptyIncidentForm(INFO), position: 2, kind: "rehost", proposal: "rehost", scores: { a: "3", b: "4" }, round: "8", players: ["u1"], note: "  Lobby weg " };
  expect(incidentPayload(form, SIDES)).toEqual({ position: 2, kind: "rehost", proposal: "rehost", score: { a: 3, b: 4 }, round: 8, players: ["u1"], note: "Lobby weg" });
  expect(incidentPayload({ ...form, scores: {}, round: "", note: "" }, SIDES)).toMatchObject({ score: null, round: null, note: null });
  expect(incidentPayload({ ...form, kind: PAUSE_BETWEEN, minutes: "7", note: "" }, SIDES)).toEqual({ position: 2, kind: "pause", between_maps: true, minutes: 7, note: null });
});

test("Entscheidung und Feststellung brauchen ihre Pflichtangaben", () => {
  expect(decisionProblem({})).toContain("wie entschieden wird");
  expect(decisionProblem({ outcome: "awarded", reason: "Begründung" })).toContain("Seite wählen");
  expect(decisionProblem({ outcome: "no_action", reason: "ok" })).toContain("begründen");
  expect(decisionProblem({ outcome: "awarded", registration_id: "a", reason: "Laut Clip" })).toBe("");
  expect(canSettleAtOnce("no_action") && canSettleAtOnce("awarded") && canSettleAtOnce("continue_at_score")).toBe(true);
  expect(canSettleAtOnce("replay") || canSettleAtOnce("restart") || canSettleAtOnce("")).toBe(false);
  expect(settleProblem({ missing_positions: [3], surplus_positions: [3], reason: "Begründung" })).toContain("zugleich");
  expect(settleProblem({ missing_positions: [], surplus_positions: [], reason: "x" })).toContain("begründen");
  expect(settleProblem({ missing_positions: [], surplus_positions: [3], reason: "Serie stand fest" })).toBe("");
});

test("offene Vorfälle stehen oben, darin die neuesten zuerst", () => {
  const rows = [{ id: "alt", open: false, at: "2026-11-11T19:00:00Z" }, { id: "neu", open: true, at: "2026-11-11T19:30:00Z" },
    { id: "offen-alt", open: true, at: "2026-11-11T19:10:00Z" }];
  expect(sortedIncidents(rows).map((row) => row.id)).toEqual(["neu", "offen-alt", "alt"]);
  expect(sortedIncidents()).toEqual([]);
});
