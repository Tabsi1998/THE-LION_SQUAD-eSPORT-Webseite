import fs from "fs";
import path from "path";
import {
  ADVANCEMENT_MODE_LABELS,
  ADVANCEMENT_MODE_TEXTS,
  drawReadyText,
  drawStateOf,
  drawStatusLines,
  modeOfSettings,
  newlyReady,
  readyDraws,
  stageModes,
} from "./advancement";
import type { BracketMatch } from "./bracketGraph";
import { motionPlan } from "./bracketMotion";

// Weiterkommen in vier Modi in der App (#1633): Modus, Zustand und Momente - auf den Bäumen aus dem echten Generator
// (frontend/e2e/fixtures/ffaGenerated.json, dieselben wie die gemeinsamen Fälle in docs/bracket-cases.json).
type Tree = { matches_v2: BracketMatch[]; registrations: Array<{ id: string; display_name: string }>; tournament: Record<string, unknown> };
const FFA: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/e2e/fixtures/ffaGenerated.json"), "utf8"));
const state = (name: string): BracketMatch[] => JSON.parse(JSON.stringify(FFA[name].matches_v2));
const idOf = (matches: BracketMatch[], key: string) => (matches.find((match) => match.match_key === key) as BracketMatch).id;
const labels = (matches: BracketMatch[]) => new Map(matches.map((match) => [match.id, String(match.round_label || "")]));
/** Die Show-Runde kurz bevor der Topf steht: dieselben Spiele ohne den Marker „bereit“. */
const notYetReady = () => state("se8_show_ready").map((match) => ({ ...match, draw_ready: null }));

describe("Modus", () => {
  test("vier Namen wie in den Einstellungen der Website, je mit Erklärung", () => {
    expect(Object.values(ADVANCEMENT_MODE_LABELS)).toEqual(["Fester Baum", "Auslosung nach der Runde", "Show-Auslosung", "Sofort zufällig"]);
    expect(ADVANCEMENT_MODE_TEXTS.draw_show).toMatch(/Auslosung bereit/);
    expect(ADVANCEMENT_MODE_TEXTS.fixed).toBe("Die Zuordnung steht im Turnierbaum: Sieger aus A trifft Sieger aus B.");
  });

  test("am Turnier: neues Feld, sonst der alte Schalter, sonst fester Baum", () => {
    expect(modeOfSettings({ advancement_mode: "draw_show" })).toBe("draw_show");
    expect(modeOfSettings({ randomize_advancement_rounds: true })).toBe("draw_round");
    expect(modeOfSettings(null)).toBe("fixed");
  });

  // Je Phase wie der Server (match_mode, advancement_mode_of): am Spiel, sonst an der Phase, sonst am Turnier.
  const modesOf = (rows: ReturnType<typeof stageModes>) => rows.map((row) => `${row.title}: ${row.mode}`);
  const inStage = (matches: BracketMatch[], id: string, strip = false) => matches.map((match) => ({
    ...match, id: `${id}-${match.id}`, stage_id: id,
    settings: strip ? { ...match.settings, advancement_mode: undefined, randomize_advancement_rounds: undefined } : match.settings,
  }));
  const fixedPhase = () => inStage(state("se8_draw_before").map((match) => ({ ...match, settings: { qualifiers_per_match: 1 } })), "A");

  test("im Baum: der Modus steht am Spiel - so wurde gebaut", () => {
    expect(modesOf(stageModes(state("se8_show_ready")))).toEqual([": draw_show"]);
    expect(modesOf(stageModes(state("se8_instant_1"), [], { advancement_mode: "fixed" }))).toEqual([": instant"]);
    expect(modesOf(stageModes(state("se8_draw_before")))).toEqual([": draw_round"]);
    expect(modesOf(stageModes([], [], { advancement_mode: "instant" }))).toEqual([]);
  });

  test("Turnier „sofort zufällig“, Phase A ausdrücklich fester Baum, Phase B Show: je Phase der eigene Modus", () => {
    const stages = [{ id: "A", name: "Vorrunde", number: 1, settings: { advancement_mode: "fixed" } }, { id: "B", name: "Finalrunde", number: 2, settings: {} }];
    const matches = [...fixedPhase(), ...inStage(state("se8_show_ready"), "B")];
    expect(modesOf(stageModes(matches, stages, { advancement_mode: "instant" }))).toEqual(["Vorrunde: fixed", "Finalrunde: draw_show"]);
    // Nur die feste Phase: fester Baum - nicht der Modus des Turniers.
    expect(modesOf(stageModes(fixedPhase(), stages, { advancement_mode: "instant" }))).toEqual(["Vorrunde: fixed"]);
    // Der feste Baum am Spiel (alter Schalter aus) geht vor Phase und Turnier.
    const builtFixed = fixedPhase().map((match) => ({ ...match, settings: { randomize_advancement_rounds: false } }));
    expect(modesOf(stageModes(builtFixed, [{ id: "A", name: "Vorrunde", settings: { advancement_mode: "draw_show" } }], { advancement_mode: "instant" }))).toEqual(["Vorrunde: fixed"]);
  });

  test("ohne Angabe am Spiel: Phase, dann Turnier - auch der alte Schalter", () => {
    expect(modesOf(stageModes(fixedPhase(), [{ id: "A", name: "Vorrunde", settings: { randomize_advancement_rounds: true } }], null))).toEqual(["Vorrunde: draw_round"]);
    expect(modesOf(stageModes(fixedPhase(), [{ id: "A", name: "Vorrunde", settings: {} }], { advancement_mode: "instant" }))).toEqual(["Vorrunde: instant"]);
    expect(modesOf(stageModes(fixedPhase(), [{ id: "A", name: "Vorrunde" }], { randomize_advancement_rounds: true }))).toEqual(["Vorrunde: draw_round"]);
    expect(modesOf(stageModes(fixedPhase(), [{ id: "A", name: "Vorrunde" }], null))).toEqual(["Vorrunde: fixed"]);
    // Gemischt, aber aus der Zeit vor den vier Modi (nur die Gruppe am Spiel): Auslosung nach der Runde.
    expect(modesOf(stageModes(inStage(state("se8_draw_before"), "A", true), [{ id: "A", name: "Vorrunde" }], null))).toEqual(["Vorrunde: draw_round"]);
  });

  test("nur die Phasen, die der Baum zeigt, in seiner Reihenfolge", () => {
    const matches = [...fixedPhase(), ...inStage(state("se8_show_ready"), "B")];
    expect(stageModes(matches, [], null, ["B"]).map((row) => row.mode)).toEqual(["draw_show"]);
  });
});

describe("was gerade passiert", () => {
  test("Show: der Topf steht - „Auslosung bereit · 4 Namen“, an den Zielspielen „Auslosung bereit“", () => {
    const matches = state("se8_show_ready");
    const ready = readyDraws(matches);
    expect(ready).toHaveLength(1);
    expect(new Set(ready[0].matchIds)).toEqual(new Set([idOf(matches, "E"), idOf(matches, "F")]));
    expect(drawReadyText(ready)).toBe("Auslosung bereit · 4 Namen");
    expect(drawStateOf(matches.find((match) => match.match_key === "E"))).toBe("ready");
    expect(drawStatusLines(matches, labels(matches))).toEqual([{ key: ready[0].key, round: "Halbfinale", text: "Auslosung bereit · 4 Namen", tone: "ready" }]);
  });

  test("Auslosung nach der Runde: „wartet auf Auslosung“, danach nichts mehr", () => {
    const before = state("se8_draw_before");
    expect(drawStateOf(before.find((match) => match.match_key === "E"))).toBe("waiting");
    expect(drawStatusLines(before, labels(before)).map((line) => `${line.round} · ${line.text}`)).toEqual(["Halbfinale · wartet auf Auslosung"]);
    const drawn = state("se8_show_drawn");
    expect(drawStateOf(drawn.find((match) => match.match_key === "E"))).toBeNull();
    expect(drawStatusLines(drawn, labels(drawn))).toEqual([]);
    expect(readyDraws(drawn)).toEqual([]);
  });

  test("sofort zufällig: „das Los entscheidet“, dann „1 von 4 zufällig gezogen“, voll: nichts mehr", () => {
    const text = (name: string) => drawStatusLines(state(name), labels(state(name))).map((line) => line.text);
    expect(text("se8_instant_0")).toEqual(["das Los entscheidet"]);
    expect(text("se8_instant_1")).toEqual(["1 von 4 zufällig gezogen"]);
    expect(text("se8_instant_4")).toEqual([]);
    expect(drawStateOf(state("se8_instant_0").find((match) => match.match_key === "E"))).toBe("instant");
  });

  test("mehrere Runden zugleich und ohne Zahl", () => {
    expect(drawReadyText([])).toBe("Auslosung bereit");
    expect(drawReadyText([{ names: 8 }, { names: 8 }])).toBe("Auslosung bereit · 2 Runden · 16 Namen");
    expect(drawReadyText([{ names: 1 }])).toBe("Auslosung bereit · 1 Name");
  });

  test("ein alter Marker „bereit“ zählt außerhalb der Show nicht", () => {
    const round = state("se8_draw_before").map((match) => (match.settings?.draw_group ? { ...match, draw_ready: { group: "WB:2", since: "x", pot_size: 4 } } : match));
    expect(readyDraws(round)).toEqual([]);
    expect(drawStateOf(round.find((match) => match.match_key === "E"))).toBe("waiting");
  });
});

describe("Momente - genau einmal", () => {
  test("Topf steht: einmal, nicht beim ersten Stand, nicht wenn er schon stand", () => {
    const seen = new Set<string>();
    expect(newlyReady(notYetReady(), state("se8_show_ready"), seen)).toHaveLength(1);
    expect(newlyReady(notYetReady(), state("se8_show_ready"), seen)).toEqual([]);
    expect(newlyReady(null, state("se8_show_ready"))).toEqual([]);
    expect(newlyReady(state("se8_show_ready"), state("se8_show_ready"))).toEqual([]);
  });

  test("Topf steht: die Zielspiele heben sich nacheinander gold an, es vibriert einmal", () => {
    const seen = new Set<string>();
    const next = state("se8_show_ready");
    const plan = motionPlan(notYetReady(), next, { active: true, seen })!;
    expect(plan.ready).toHaveLength(1);
    expect(plan.draw).toBe(true);
    expect([...plan.lifts.entries()]).toEqual([[idOf(next, "E"), { delay: 0, tone: "ready" }], [idOf(next, "F"), { delay: 90, tone: "ready" }]]);
    // Derselbe Wechsel noch einmal (Nachladen, Neuverbindung): kein zweiter Moment.
    expect(motionPlan(notYetReady(), state("se8_show_ready"), { active: true, seen })).toBeNull();
  });

  test("ausgelost: die Namen kommen gestaffelt, beide Karten heben sich mit ihrem ersten Namen", () => {
    const next = state("se8_show_drawn");
    const plan = motionPlan(state("se8_show_ready"), next, { active: true, seen: new Set() })!;
    expect(plan.draw).toBe(true);
    expect(plan.ready).toEqual([]);
    expect(plan.assigned).toEqual([]);
    const delays = [...plan.rows.values()].flatMap((rows) => [...rows.values()].map((row) => row.delay));
    expect(delays).toEqual([0, 60, 120, 180]);
    expect([...plan.lifts.values()].map((lift) => lift.tone)).toEqual(["draw", "draw"]);
  });

  test("sofort zufällig: ein Name auf seinem gezogenen Platz - genau einmal", () => {
    const seen = new Set<string>();
    const next = state("se8_instant_1");
    const plan = motionPlan(state("se8_instant_0"), next, { active: true, seen })!;
    expect(plan.assigned).toHaveLength(1);
    expect(plan.assigned[0].matchId).toBe(plan.lifts.keys().next().value);
    expect(plan.draw).toBe(true);
    expect(motionPlan(state("se8_instant_0"), state("se8_instant_1"), { active: true, seen })).toBeNull();
  });

  test("fester Baum: Weiterkommen ist keine Auslosung - keine Karte hebt sich", () => {
    const TREES = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/bracket-trees.json"), "utf8"));
    const plan = motionPlan(TREES.se6_live.matches_v2, TREES.se6_done.matches_v2, { active: true, seen: new Set() })!;
    expect(plan.draw).toBe(false);
    expect(plan.lifts.size).toBe(0);
  });
});
