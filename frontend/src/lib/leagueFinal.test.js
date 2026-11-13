import { closeState, decisionLine, finalNote, historyLine, methodOptions, reopenProblem, seasonSummary, staffelLabel, untilText } from "./leagueFinal";

test("Stand einer Staffel: abgeschlossen, bereit oder mit der Zahl der offenen Punkte", () => {
  expect(closeState({ closed: true, blockers: [] })).toEqual({ key: "closed", label: "Abgeschlossen" });
  expect(closeState({ closed: false, blockers: [] })).toEqual({ key: "ready", label: "Bereit zum Abschluss" });
  expect(closeState({ blockers: [{ code: "open_matches" }] }).label).toBe("1 Punkt offen");
  expect(closeState({ blockers: [{}, {}] })).toEqual({ key: "blocked", label: "2 Punkte offen" });
});

test("die Season ist erst beendet, wenn alle Staffeln abgeschlossen sind", () => {
  expect(seasonSummary({ staffeln: [] })).toBe("Noch keine gestartete Staffel.");
  expect(seasonSummary({ staffeln: [{ closed: true }, { closed: false }] })).toContain("1 von 2 Staffeln abgeschlossen");
  expect(seasonSummary({ staffeln: [{ closed: true }, { closed: true }] })).toBe("Alle 2 Staffeln sind abgeschlossen – die Season ist beendet.");
  expect(seasonSummary({ staffeln: [{ closed: true }] })).toBe("Die Staffel ist abgeschlossen – die Season ist beendet.");
});

test("Name der Staffel, Frist und Endstand-Zeile in Wiener Zeit", () => {
  expect(staffelLabel({ division_label: "Liga 1", staffel: "A" })).toBe("Liga 1 · Staffel A");
  expect(staffelLabel({ title: "Probe-Staffel" })).toBe("Probe-Staffel");
  expect(untilText({ until: "2026-11-14T17:00:00+00:00" })).toBe("bis 14.11.2026, 18:00");
  expect(untilText({})).toBe("");
  expect(finalNote({ closed_at: "2026-11-12T23:30:00+00:00" })).toBe("Endstand · abgeschlossen am 13.11.2026");
  expect(finalNote(null)).toBe("");
});

test("Entscheid und Verlauf als ein Satz", () => {
  expect(decisionLine({ names: ["Probe 2", "Probe 3"], method_label: "Entscheidungsspiel", reason: "2:1 gewonnen" }))
    .toBe("Probe 2 vor Probe 3 – Entscheidungsspiel: 2:1 gewonnen");
  expect(decisionLine({ names: ["A", "B"], reason: "Los vor Zeugen" })).toBe("A vor B – Los vor Zeugen");
  expect(historyLine({ version: 2, closed_at: "2026-11-12T17:00:00+00:00", closed_by_name: "Erste Leitung" })).toBe("Fassung 2 · 12.11.2026, 18:00 · Erste Leitung");
  expect(methodOptions({ playoff: "Entscheidungsspiel", lot: "Los" })).toEqual([["playoff", "Entscheidungsspiel"], ["lot", "Los"]]);
});

test("Wieder öffnen: Grund ist Pflicht, die Notausnahmen brauchen ihren eigenen", () => {
  expect(reopenProblem({ reason: "ups" })).toContain("mindestens 5 Zeichen");
  expect(reopenProblem({ reason: "Ergebnis falsch" })).toBe("");
  expect(reopenProblem({ reason: "Ergebnis falsch", needsEmergency: true, emergencyReason: "" })).toContain("selbst abgeschlossen");
  expect(reopenProblem({ reason: "Ergebnis falsch", needsConflict: true, conflictReason: "" })).toContain("eigenes Team");
  expect(reopenProblem({ reason: "Ergebnis falsch", needsEmergency: true, emergencyReason: "Niemand da", needsConflict: true, conflictReason: "Niemand da" })).toBe("");
});
