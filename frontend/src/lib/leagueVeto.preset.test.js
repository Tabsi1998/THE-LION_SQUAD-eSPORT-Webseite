import { describe, expect, it } from "vitest";
import {
  KIND_OPTIONS, applyRotation, changedWeeks, historyLine, isSystemKind, mapStatusText, missingWeeks, overwriteCount, plannedRoleLabel,
  presetChangeLine, presetModes, presetStale, presetValue, presetsPayload, presetsToForm, readyText, staleWeeks, stepLabel, stepSentence,
  templateProblems, vetoHeadline, vetoRulesPayload, vetoText, weekDates, weekList, weekLocked, withPreset,
} from "./leagueVeto";

// Veto-Schrittart „Vorgabe der Woche“ (#2326): Vorlage prüfen wie der Server, die Vorgaben je Spielwoche als Formular und die Sätze der
// Matchseite. Erfundene Modi und Maps.

const MODES = [{ mode: "hp", label: "Stellung", maps: 4 }, { mode: "snd", label: "Suchen", maps: 4 }, { mode: "ctl", label: "Kontrolle", maps: 3 }];
const ORDER = ["hp", "snd", "ctl", "hp", "snd"];
const step = (kind, mode, team = null, position = "") => ({ kind, mode, team, position: position === "" ? "" : String(position) });
const HEAD = [
  step("ban", "hp", "A"), step("ban", "hp", "B"), step("pick", "hp", "A", 1), step("pick", "hp", "B", 4),
  step("ban", "snd", "B"), step("ban", "snd", "A"), step("pick", "snd", "B", 2), step("pick", "snd", "A", 5),
];
const WITH_PRESET = [...HEAD, step("preset", "ctl", null, 3)];
const form = (steps) => ({ enabled: true, team_a: "home", step_seconds: "60", steps });
const check = (steps, extra = {}) => templateProblems(form(steps), { modes: MODES, bestOf: 5, order: ORDER, repeat: "other_mode", ...extra });

describe("Vorlage mit Vorgabe der Woche", () => {
  it("ist eine eigene Art ohne Team, mit Position - und zählt in der Prüfung mit", () => {
    expect(KIND_OPTIONS.map(([value]) => value)).toEqual(["ban", "pick", "decider", "preset"]);
    expect(isSystemKind("preset")).toBe(true);
    expect(isSystemKind("pick")).toBe(false);
    expect(vetoRulesPayload(form([{ kind: "preset", mode: "ctl", team: "A", position: "3" }])).steps).toEqual([{ kind: "preset", mode: "ctl", team: null, position: 3 }]);
    expect(stepSentence(step("preset", "ctl", null, 3), () => "Kontrolle")).toBe("Die Liga-Leitung gibt Map 3 je Spielwoche vor (Kontrolle)");
    expect(check(WITH_PRESET)).toEqual([]);
    // Gegenprobe: ohne den Schritt bleibt Position 3 offen.
    expect(check(HEAD)).toEqual(["Position 3 ist nicht belegt – ohne Wahl oder Decider bleibt sie offen."]);
    expect(check([...HEAD, step("ban", "ctl", "A"), step("ban", "ctl", "B"), step("preset", "ctl", null, 3)], { modes: [...MODES.slice(0, 2), { mode: "ctl", label: "Kontrolle", maps: 2 }] }))
      .toContain("Kontrolle: 2 Sperren und 0 Wahlen und die Vorgabe der Woche brauchen 3 Maps – der Pool hat 2.");
    expect(check([...WITH_PRESET, step("preset", "ctl", null, 3)])).toContain("Kontrolle: höchstens eine Vorgabe der Woche je Modus.");
    expect(check([...HEAD, step("preset", "ctl", null, 6)])).toContain("Schritt 9: Position 6 gibt es bei Best of 5 nicht.");
    expect(check([...HEAD, step("preset", "ctl", null, "")])).toEqual(["Schritt 9: Position - bitte eine ganze Zahl ab 1."]);
  });

  it("Vorgabe und Decider im selben Modus: genau eine Map bleibt übrig, egal wo der Schritt steht", () => {
    const mixed = [step("ban", "hp", "A"), step("ban", "hp", "B"), step("preset", "hp", null, 1), step("decider", "hp", null, 4), ...HEAD.slice(4), step("preset", "ctl", null, 3)];
    expect(check(mixed)).toEqual([]);
    expect(check(mixed, { modes: [{ mode: "hp", label: "Stellung", maps: 5 }, ...MODES.slice(1)] }))
      .toEqual(["Stellung: Der Decider braucht genau eine übrige Map – nach 2 Sperren und 0 Wahlen und der Vorgabe der Woche bleiben 2."]);
    const late = [step("ban", "hp", "A"), step("ban", "hp", "B"), step("decider", "hp", null, 4), step("preset", "hp", null, 1), ...HEAD.slice(4), step("preset", "ctl", null, 3)];
    expect(check(late)).toEqual([]);
  });
});

describe("Vorgaben je Spielwoche", () => {
  const weeks = [{ week: 1, start_day: "2026-11-10", end_day: "2026-11-16" }, { week: 2, start_day: "2026-11-17", end_day: "2026-11-23" }, { week: 3, start_day: null, end_day: null }];
  const modes = [{ mode: "ctl", label: "Kontrolle", position: 3, maps: [{ map_id: "hafen", name: "Hafen" }, { map_id: "kai", name: "Kai" }] }];

  it("Formular hin und zurück, fehlende Wochen, Rotation als Vorschlag", () => {
    expect(presetModes(WITH_PRESET)).toEqual(["ctl"]);
    expect(presetModes(HEAD)).toEqual([]);
    let state = presetsToForm([{ week: 1, mode: "ctl", map_id: "kai" }]);
    expect(presetValue(state, 1, "ctl")).toBe("kai");
    expect(presetValue(state, 2, "ctl")).toBe("");
    expect(missingWeeks(state, weeks, modes)).toEqual([2, 3]);
    state = withPreset(state, 2, "ctl", "hafen");
    expect(presetsPayload(state, weeks, modes)).toEqual([{ week: 1, mode: "ctl", map_id: "kai" }, { week: 2, mode: "ctl", map_id: "hafen" }]);
    expect(missingWeeks(state, weeks, modes)).toEqual([3]);
    // „Noch nicht gewählt“ nimmt die Woche wieder heraus.
    expect(presetsPayload(withPreset(state, 1, "ctl", ""), weeks, modes)).toEqual([{ week: 2, mode: "ctl", map_id: "hafen" }]);
    const rotation = [{ week: 1, mode: "ctl", map_id: "hafen" }, { week: 2, mode: "ctl", map_id: "kai" }, { week: 3, mode: "ctl", map_id: "hafen" }];
    // „Rotiert automatisch durch den Pool“ füllt nur leere Wochen: Woche 1 (Kai) und 2 (Hafen) bleiben, Woche 3 kommt dazu.
    const rotated = applyRotation(state, rotation, weeks);
    expect(missingWeeks(rotated, weeks, modes)).toEqual([]);
    expect([1, 2, 3].map((week) => presetValue(rotated, week, "ctl"))).toEqual(["kai", "hafen", "hafen"]);
    expect(changedWeeks(rotated, state, weeks, modes)).toEqual([3]);
    // „Alle neu verteilen“ ersetzt auch gewählte Wochen - die Rückfrage nennt, wie viele: Woche 1 und 2 bekämen eine andere Map.
    expect(overwriteCount(state, rotation, weeks)).toBe(2);
    const all = applyRotation(state, rotation, weeks, { overwrite: true });
    expect([1, 2, 3].map((week) => presetValue(all, week, "ctl"))).toEqual(["hafen", "kai", "hafen"]);
    expect(changedWeeks(all, state, weeks, modes)).toEqual([1, 2, 3]);
    // Vergangene Wochen und Wochen mit begonnenem Veto bleiben immer - auch leer und auch bei „Alle neu verteilen“.
    const kept = [{ ...weeks[0], past: true }, { ...weeks[1], started: true }, weeks[2]];
    expect(kept.map(weekLocked)).toEqual([true, true, false]);
    expect(overwriteCount(state, rotation, kept)).toBe(0);
    const partly = applyRotation(withPreset(state, 2, "ctl", ""), rotation, kept, { overwrite: true });
    expect([1, 2, 3].map((week) => presetValue(partly, week, "ctl"))).toEqual(["kai", "", "hafen"]);
    expect(presetValue(applyRotation({}, rotation, kept), 2, "ctl")).toBe("");
    // Eine Map außerhalb des Pools bleibt im Formular stehen und geht unverändert mit - sie gilt weder als leer noch wird sie verworfen.
    const old = presetsToForm([{ week: 1, mode: "ctl", map_id: "weg" }, { week: 2, mode: "ctl", map_id: "kai" }]);
    expect(presetStale(old, 1, modes[0])).toBe(true);
    expect(presetStale(old, 2, modes[0])).toBe(false);
    expect(presetStale(old, 3, modes[0])).toBe(false);
    expect(staleWeeks(old, weeks, modes)).toEqual([1]);
    expect(missingWeeks(old, weeks, modes)).toEqual([3]);
    expect(presetsPayload(old, weeks, modes)[0]).toEqual({ week: 1, mode: "ctl", map_id: "weg" });
    expect(presetValue(applyRotation(old, rotation, weeks), 1, "ctl")).toBe("weg");
    expect(staleWeeks(withPreset(old, 1, "ctl", "hafen"), weeks, modes)).toEqual([]);
    // Wochen oder Modi, die es nicht mehr gibt, gehen nicht an den Server.
    expect(presetsPayload({ ...rotated, "9|ctl": "kai", "1|hp": "kai" }, weeks, modes)).toHaveLength(3);
  });

  it("beschriftet Wochen und Historie", () => {
    expect(weekDates(weeks[0])).toBe("10.11.–16.11.");
    expect(weekDates(weeks[2])).toBe("");
    expect(weekList([3])).toBe("3");
    expect(weekList([3, 4, 5])).toBe("3, 4 und 5");
    expect(weekList([])).toBe("");
    expect(presetChangeLine({ week: 1, mode: "ctl", from: "kai", to: "hafen" }, modes)).toBe("Spielwoche 1 · Kontrolle: Kai → Hafen");
    expect(presetChangeLine({ week: 2, mode: "ctl", from: null, to: "kai" }, modes)).toBe("Spielwoche 2 · Kontrolle: – → Kai");
    expect(presetChangeLine({ week: 2, mode: "ctl", from: "weg", to: null }, modes)).toBe("Spielwoche 2 · Kontrolle: eine Map außerhalb des Pools → –");
  });
});

describe("Matchseite", () => {
  it("nennt die Vorgabe der Woche in Brett, Verlauf, Schritt und Spielreihenfolge", () => {
    expect(mapStatusText({ status: "preset", position: 3 })).toBe("Map 3 · Vorgabe der Woche");
    expect(historyLine({ index: 8, kind: "preset", map_name: "Kai", position: 3, mode_label: "Kontrolle", via: "auto" })).toBe("9. Vorgabe der Woche: Kai → Map 3 (Kontrolle)");
    expect(stepLabel({ number: 9, total: 9, kind: "preset", mode_label: "Kontrolle", position: 3, name: null })).toBe("Schritt 9 von 9 · Kontrolle · Vorgabe der Woche für Map 3");
    expect(vetoText({ status: "running", current: { kind: "preset", position: 3 } })).toBe("Die Vorgabe der Woche wird Map 3 – das setzt das System.");
    expect(plannedRoleLabel("preset")).toBe("Vorgabe der Woche");
    expect(plannedRoleLabel("decider")).toBe("Decider");
    expect(plannedRoleLabel("picked")).toBe("");
  });

  it("sagt klar, wenn das Veto auf die Vorgabe wartet", () => {
    const text = "Für Spielwoche 3 steht die Vorgabe der Woche noch nicht – Kontrolle: Die Vorgabe der Woche fehlt. Das Veto beginnt erst, wenn die Liga-Leitung sie eingetragen hat.";
    const blocked = { status: "waiting", blocked: { week: 3, text } };
    expect(vetoHeadline(blocked)).toBe("Veto wartet auf die Vorgabe der Woche");
    expect(vetoText(blocked)).toBe(text);
    // Gegenprobe: mit Vorgabe wartet es nur auf den Check-in.
    const waiting = { status: "waiting", blocked: null };
    expect(vetoHeadline(waiting)).toBe("Vorgabe der Woche");
    expect(vetoText(waiting)).toBe("Sobald beide Seiten eingecheckt sind, beginnt das Map-Veto – danach startet Map 1.");
    expect(vetoHeadline({ status: "running" })).toBe("Veto läuft");
  });

  it("nachgetragen: beide Seiten tippen „Bereit zum Veto“ - der Satz sagt jeder Seite, wer schon bereit ist", () => {
    const sides = (own, other) => [{ registration_id: "a", name: "Löwen", ready: own, own: true }, { registration_id: "b", name: "Falken", ready: other, own: false }];
    const start = { sides: sides(false, false), own_ready: false, other_ready: false, can_ready: true, can_withdraw: false };
    const ready = { status: "waiting", blocked: null, presets: [{ mode: "ctl" }], start };
    expect(vetoHeadline(ready)).toBe("Vorgabe steht – bereit zum Veto?");
    // Steht der Schritt „Vorgabe“ nicht mehr in der Vorlage, bleibt nur die Frage.
    expect(vetoHeadline({ ...ready, presets: [] })).toBe("Bereit zum Veto?");
    expect(vetoText(ready)).toBe("Tippt auf „Bereit zum Veto“, sobald ihr so weit seid. Das Veto beginnt, wenn beide Seiten bereit sind.");
    expect(readyText({ ...start, sides: sides(true, false), own_ready: true, can_ready: false, can_withdraw: true })).toBe("Ihr seid bereit – wartet auf die Gegenseite.");
    expect(readyText({ ...start, sides: sides(false, true), other_ready: true })).toBe("Falken ist bereit – tippt auf „Bereit zum Veto“, dann beginnt es sofort.");
    // Wer keine Seite vertritt (Leitung, Mitspieler ohne Amt), liest den Stand.
    const watching = sides(true, false).map((row) => ({ ...row, own: false }));
    expect(readyText({ ...start, sides: watching, can_ready: false })).toBe("Löwen ist bereit. Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.");
    expect(readyText({ ...start, sides: watching.map((row) => ({ ...row, ready: false })), can_ready: false })).toBe("Das Veto beginnt, sobald beide Seiten „Bereit zum Veto“ getippt haben.");
  });

  it("beide bereit, aber die Vorgabe fehlt wieder: die fehlende Vorgabe geht vor, danach beginnt das Veto von selbst", () => {
    const text = "Das Veto beginnt, sobald die Liga-Leitung die Vorgabe für Spielwoche 1 eingetragen hat.";
    const sides = [{ registration_id: "a", name: "Löwen", ready: true, own: true }, { registration_id: "b", name: "Falken", ready: true, own: false }];
    const start = { sides, own_ready: true, other_ready: true, can_ready: false, can_withdraw: true };
    const stuck = { status: "waiting", blocked: { week: 1, text }, presets: [], start };
    expect(vetoHeadline(stuck)).toBe("Veto wartet auf die Vorgabe der Woche");
    expect(vetoText(stuck)).toBe(text);
    // Die Vorgabe steht wieder: Der Satz sagt beiden Seiten und der Leitung, dass es gleich losgeht.
    const back = { ...stuck, blocked: null, presets: [{ mode: "ctl" }] };
    expect(vetoHeadline(back)).toBe("Vorgabe steht – bereit zum Veto?");
    expect(vetoText(back)).toBe("Beide Seiten sind bereit – das Veto beginnt gleich.");
    expect(readyText({ ...start, sides: sides.map((row) => ({ ...row, own: false })), own_ready: false, can_withdraw: false })).toBe("Beide Seiten sind bereit – das Veto beginnt gleich.");
    // Gegenprobe: Ist nur die eigene Seite bereit, wartet sie weiter auf die Gegenseite.
    expect(readyText({ ...start, sides: [sides[0], { ...sides[1], ready: false }], other_ready: false })).toBe("Ihr seid bereit – wartet auf die Gegenseite.");
  });
});
