import {
  PAUSE_BETWEEN, emptyIncidentForm, holdNotice, incidentPayload, incidentProblem, mapStateNotes, positionLabel, quotaHint, quotaText, remainingMs,
  remainingShare, remainingText, scoreText, settleSentence, showsProposal, sortedIncidents, stateSentence, type Incident,
} from "./leagueIncidents";

// Vorfälle (D.5, #1619; App #2173): dieselben Sätze und Prüfungen wie frontend/src/lib/leagueIncidents.js. Erfundene Namen.

const SIDES = [{ registration_id: "a", name: "Rudel A" }, { registration_id: "b", name: "Horst" }];
const INFO = { quota: { limit: 1, used: [{ registration_id: "a", position: 2, count: 1 }] }, break_minutes: 5 };

test("Antwortzeit: Restzeit, Text und Anteil mit der Uhr des Servers", () => {
  const now = Date.parse("2026-11-20T20:00:00Z");
  const incident = { at: "2026-11-20T20:00:00Z", answer_deadline: "2026-11-20T20:10:00Z" };
  expect(remainingMs(incident.answer_deadline, now)).toBe(600000);
  expect(remainingMs(incident.answer_deadline, now, 600000)).toBe(0);
  expect(remainingText(247000)).toBe("4:07");
  expect(remainingShare(incident, now + 300000)).toBe(0.5);
});

test("Stand, Map-Name aus dem Veto und Kontingent in Worten", () => {
  expect(scoreText({ a: 3, b: 4 }, SIDES)).toBe("3:4");
  expect(scoreText({ a: 3 }, SIDES)).toBe("");
  expect(positionLabel({ planned_games: [{ position: 2, map_name: "Turm" }] }, 2)).toBe("Map 2 · Turm");
  expect(positionLabel({}, 1)).toBe("Map 1");
  expect(quotaText(INFO, "a", 2)).toBe("1 von 1 genutzt");
  expect(quotaHint(INFO, "a", 1, "rehost")).toBe("Zählt gegen euer Kontingent auf dieser Map: bisher 0 von 1 genutzt.");
  expect(quotaHint(INFO, "a", 2, "pause")).toContain("aufgebraucht (1 von 1)");
  expect(quotaHint(INFO, "a", 2, "moss_crash")).toBe("");
});

test("der eine Satz je Stand - wer dran ist", () => {
  const base: Incident = { id: "i1", position: 1, state: "proposed" };
  expect(stateSentence({ ...base, can_answer: true })).toBe("Ihr seid dran: stimmt zu oder lehnt ab.");
  expect(stateSentence({ ...base, reported_by: { own: true } })).toBe("Die Gegenseite antwortet noch.");
  expect(stateSentence(base, { ownSide: true })).toBe("Euer Captain oder Vertreter ist dran: zustimmen oder ablehnen.");
  expect(stateSentence(base, { otherName: "Horst" })).toBe("Horst antwortet noch.");
  expect(stateSentence({ ...base, expired: true })).toBe("Die Antwortzeit ist vorbei – der Vorfall geht an die Liga-Leitung.");
  expect(stateSentence({ ...base, state: "in_review", review_cause: "rejected" }, { mode: "continue" }))
    .toBe("Die Gegenseite hat abgelehnt. Die Serie läuft unter Vorbehalt weiter, gewertet wird nach der Entscheidung.");
  expect(stateSentence({ ...base, state: "decided", decision: { outcome_label: "Map zugesprochen", awarded_to: "Horst" } }))
    .toBe("Entscheidung der Liga-Leitung: Map zugesprochen (Horst).");
  expect(stateSentence({ ...base, between_maps: true, minutes: 12 })).toBe("Pause von 12 Minuten nach Map 1 – nur festgehalten.");
  expect(showsProposal({ ...base, state: "decided", proposal: "replay", proposal_label: "Wiederholen", decision: { outcome: "replay" } })).toBe(false);
  expect(settleSentence({ settled_at: "x", missing_positions: [3] })).toBe("Serie festgestellt: Es fehlt noch Map 3.");
  expect(settleSentence({})).toBe("Die Serie ist noch nicht festgestellt – bis dahin gilt kein Ergebnis.");
});

test("Formular: was fehlt, und was an den Server geht", () => {
  const form = emptyIncidentForm(INFO);
  expect(incidentProblem(form, SIDES)).toBe("Bitte wählen, um welche Map es geht.");
  expect(incidentProblem({ ...form, position: 1 }, SIDES)).toBe("Bitte wählen, was passiert ist.");
  expect(incidentProblem({ ...form, position: 1, kind: "disconnect", scores: { a: "3" } }, SIDES)).toContain("beider Seiten als ganze Zahl");
  expect(incidentProblem({ ...form, position: 1, kind: "disconnect" }, SIDES)).toBe("Bitte einen Vorschlag wählen, wie es weitergeht.");
  expect(incidentProblem({ ...form, position: 1, kind: "other", proposal: "replay", note: "kurz" }, SIDES)).toContain("mindestens fünf Zeichen");
  expect(incidentProblem({ ...form, position: 1, kind: PAUSE_BETWEEN, minutes: "200" }, SIDES)).toContain("0 bis 120");
  const ready = { ...form, position: 2 as const, kind: "disconnect", proposal: "continue_at_score", scores: { a: "3", b: "4" }, round: "7", players: ["p1"], note: " Server weg " };
  expect(incidentProblem(ready, SIDES)).toBe("");
  expect(incidentPayload(ready, SIDES)).toEqual({ position: 2, kind: "disconnect", proposal: "continue_at_score", score: { a: 3, b: 4 }, round: 7, players: ["p1"], note: "Server weg" });
  expect(incidentPayload({ ...form, position: 1, kind: PAUSE_BETWEEN, minutes: "10" }, SIDES)).toEqual({ position: 1, kind: "pause", between_maps: true, minutes: 10, note: null });
});

test("öffentlich nur „in Klärung“ und „zählt nicht“; Hinweis nur nach Neustart; offene Vorfälle zuerst", () => {
  expect(mapStateNotes({ map_state: [{ position: 1, state: "in_clarification" }, { position: 3, surplus: true }, { position: 2 }] }).map((note) => note.text))
    .toEqual(["Map 1 ist in Klärung", "Map 3 zählt nicht (Entscheidung der Liga-Leitung)"]);
  expect(holdNotice({ hold: { code: "rereport", text: "Map 2 wird wiederholt" } })).toBe("Map 2 wird wiederholt");
  expect(holdNotice({ hold: { code: "other", text: "x" } })).toBe("");
  expect(sortedIncidents([{ id: "a", position: 1, open: false, at: "2" }, { id: "b", position: 1, open: true, at: "1" }, { id: "c", position: 1, open: true, at: "3" }]).map((row) => row.id))
    .toEqual(["c", "b", "a"]);
});
