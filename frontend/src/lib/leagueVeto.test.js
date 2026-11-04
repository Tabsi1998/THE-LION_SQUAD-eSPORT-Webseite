import { describe, expect, it } from "vitest";
import {
  actionWord, emptyStep, historyLine, mapStatusText, moveStep, stepLabel, stepSentence, templateProblems, vetoDeadline, vetoRingShare,
  vetoRulesPayload, vetoText,
} from "./leagueVeto";

// Veto (#1618): die Vorlage live prüfen wie der Server, die Sätze der Matchseite. Erfundene Modi.

const MODES = [{ mode: "hp", label: "Stellung", maps: 4 }, { mode: "snd", label: "Suchen", maps: 4 }, { mode: "ctl", label: "Kontrolle", maps: 3 }];
const ORDER = ["hp", "snd", "ctl", "hp", "snd"];
const step = (kind, mode, team = null, position = "") => ({ kind, mode, team, position });
const ANLAGE_B = [
  step("ban", "hp", "A"), step("ban", "hp", "B"), step("pick", "hp", "A", "1"), step("pick", "hp", "B", "4"),
  step("ban", "snd", "B"), step("ban", "snd", "A"), step("pick", "snd", "B", "2"), step("pick", "snd", "A", "5"),
  step("ban", "ctl", "A"), step("ban", "ctl", "B"), step("decider", "ctl", null, "3"),
];
const form = (steps = ANLAGE_B, extra = {}) => ({ enabled: true, team_a: "home", step_seconds: "60", steps, ...extra });
const check = (steps, extra = {}) => templateProblems(form(steps), { modes: MODES, bestOf: 5, order: ORDER, ...extra });

describe("Vorlage prüfen", () => {
  it("Anlage B geht auf, die Sätze sind die des Servers", () => {
    expect(check(ANLAGE_B)).toEqual([]);
    expect(check([...ANLAGE_B.slice(0, 8), step("ban", "ctl", "A"), step("decider", "ctl", null, "3")]))
      .toContain("Kontrolle: Der Decider braucht genau eine übrige Map – nach 1 Sperre und 0 Wahlen bleiben 2.");
    expect(check([...ANLAGE_B.slice(0, 3), step("pick", "hp", "B", "1"), ...ANLAGE_B.slice(4)]))
      .toEqual(expect.arrayContaining(["Position 1 ist mehrfach belegt (Schritt 3 und 4).", "Position 4 ist nicht belegt – ohne Wahl oder Decider bleibt sie offen."]));
    expect(check([...ANLAGE_B.slice(0, 2), step("pick", "hp", "A", "2"), step("pick", "hp", "B", "4"), ...ANLAGE_B.slice(4)]))
      .toContain("Schritt 3: Auf Position 2 wird laut „Modus je Map“ Suchen gespielt, nicht Stellung.");
    expect(check(ANLAGE_B, { modes: [{ mode: "hp", label: "Stellung", maps: 3 }, ...MODES.slice(1)] }))
      .toEqual(["Stellung: 2 Sperren und 2 Wahlen brauchen 4 Maps – der Pool hat 3."]);
    expect(check([...ANLAGE_B.slice(0, 7), step("pick", "snd", "A", "6"), ...ANLAGE_B.slice(8)])).toContain("Schritt 8: Position 6 gibt es bei Best of 5 nicht.");
    expect(check([step("ban", "nacht", "A"), ...ANLAGE_B])).toContain("Schritt 1: Der Modus „nacht“ hat keine Maps im Pool.");
    expect(check([...ANLAGE_B.slice(0, 8), step("decider", "ctl", null, "3"), step("decider", "ctl", null, "3")])).toContain("Kontrolle: höchstens ein Decider je Modus.");
    expect(check([])).toEqual(["Die Vorlage hat noch keine Schritte."]);
  });

  it("unvollständige Zeilen zuerst, bei „nie“ ohne die Decider-Genauigkeit", () => {
    expect(check([step("ban", "", "A"), step("pick", "hp", null, ""), step("pick", "hp", "A", "")]))
      .toEqual(["Schritt 1: bitte den Modus wählen.", "Schritt 2: bitte Team A oder Team B wählen.", "Schritt 2: Position - bitte eine ganze Zahl ab 1.", "Schritt 3: Position - bitte eine ganze Zahl ab 1."]);
    expect(check([...ANLAGE_B.slice(0, 8), step("ban", "ctl", "A"), step("decider", "ctl", null, "3")], { repeat: "never" })).toEqual([]);
  });

  it("baut die Anfrage mit Zahlen, ohne Team beim Decider und ohne Position bei Sperren", () => {
    expect(vetoRulesPayload(form(ANLAGE_B.slice(0, 3), { step_seconds: "90", team_a: "draw" }))).toEqual({
      enabled: true, team_a: "draw", step_seconds: 90,
      steps: [{ kind: "ban", mode: "hp", team: "A", position: null }, { kind: "ban", mode: "hp", team: "B", position: null }, { kind: "pick", mode: "hp", team: "A", position: 1 }],
    });
    expect(vetoRulesPayload({ enabled: false, step_seconds: "", steps: [step("decider", "ctl", "A", "3")] }))
      .toEqual({ enabled: false, team_a: "home", step_seconds: 60, steps: [{ kind: "decider", mode: "ctl", team: null, position: 3 }] });
  });

  it("Schritte schieben und beschreiben", () => {
    const steps = [emptyStep("hp"), step("pick", "snd", "B", "2")];
    expect(moveStep(steps, 1, -1)[0].kind).toBe("pick");
    expect(moveStep(steps, 0, -1)).toBe(steps);
    expect(moveStep(steps, 1, 1)).toBe(steps);
    const labelOf = (mode) => MODES.find((row) => row.mode === mode)?.label;
    expect(stepSentence(step("ban", "hp", "A"), labelOf)).toBe("Team A sperrt eine Map (Stellung)");
    expect(stepSentence(step("pick", "snd", "B", "4"), labelOf)).toBe("Team B wählt Map 4 (Suchen)");
    expect(stepSentence(step("decider", "ctl", null, "3"), labelOf)).toBe("Die übrige Map wird Map 3 (Kontrolle)");
  });
});

describe("Matchseite", () => {
  const current = { index: 2, number: 3, total: 11, kind: "pick", mode: "hp", mode_label: "Stellung", name: "Loewen", position: 1, deadline_at: new Date(Date.now() + 30000).toISOString() };
  it("sagt in einem Satz, wer dran ist und was zu tun ist", () => {
    expect(vetoText({ status: "running", own_turn: true, current, step_seconds: 60 })).toBe("Ihr seid am Zug: wählt Map 1 (Stellung). Nach 60 Sekunden wählt das System.");
    expect(vetoText({ status: "running", own_turn: false, current: { ...current, kind: "ban" } })).toBe("Loewen ist am Zug: sperrt eine Map (Stellung).");
    expect(vetoText({ status: "running", current: { ...current, kind: "decider", position: 3 } })).toBe("Die übrige Map wird Map 3 – das setzt das System.");
    expect(vetoText({ status: "paused", paused: { reason: "Störung" } })).toBe("Die Liga-Leitung hat das Veto angehalten – Störung. Es geht weiter, sobald sie es fortsetzt.");
    expect(vetoText({ status: "done" })).toBe("Die Spielreihenfolge steht – Map 1 kann beginnen.");
    expect(vetoText({ status: "skipped", skipped_reason: "Position 4 gibt es bei Best of 3 nicht." })).toContain("läuft kein Veto: Position 4");
    expect(vetoText({ status: "waiting" })).toContain("Sobald beide Seiten eingecheckt sind");
    expect(stepLabel(current)).toBe("Schritt 3 von 11 · Stellung · Loewen wählt Map 1");
    expect(stepLabel({ ...current, kind: "decider", name: null, position: 3 })).toBe("Schritt 3 von 11 · Stellung · Decider für Map 3");
    expect(actionWord("ban")).toBe("Sperren");
    expect(actionWord("pick")).toBe("Wählen");
  });

  it("Countdown nur im laufenden Schritt, der Ring über die Zeit je Schritt", () => {
    const block = { status: "running", current, step_seconds: 60 };
    expect(vetoDeadline(block)).toBe(new Date(current.deadline_at).getTime());
    expect(vetoDeadline({ ...block, status: "paused" })).toBeNull();
    expect(vetoRingShare(block, new Date(current.deadline_at).getTime() - 30000)).toBeCloseTo(0.5, 1);
    expect(vetoRingShare({ ...block, status: "done" })).toBe(1);
  });

  it("Zeilen für Maps und Verlauf", () => {
    expect(mapStatusText({ status: "banned", by_name: "Loewen" })).toBe("gesperrt von Loewen");
    expect(mapStatusText({ status: "picked", position: 1, by_name: "Loewen" })).toBe("Map 1 · Loewen");
    expect(mapStatusText({ status: "decider", position: 3 })).toBe("Map 3 · Decider");
    expect(mapStatusText({ status: "open" })).toBe("offen");
    expect(historyLine({ index: 0, kind: "ban", name: "Loewen", map_name: "Glut", mode_label: "Stellung", via: "side" })).toBe("1. Loewen sperrt Glut (Stellung)");
    expect(historyLine({ index: 2, kind: "pick", name: "Loewen", map_name: "Hafen", mode_label: "Stellung", position: 1, via: "auto" }))
      .toBe("3. Loewen wählt Hafen → Map 1 (Stellung) · Zeit abgelaufen, das System hat gewählt");
    expect(historyLine({ index: 10, kind: "decider", map_name: "Hafen", mode_label: "Kontrolle", position: 3, via: "auto" })).toBe("11. Decider: Hafen → Map 3 (Kontrolle)");
  });
});
