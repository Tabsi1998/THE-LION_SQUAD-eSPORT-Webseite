import { describe, expect, it } from "vitest";
// TV-Bäume aus dem echten Generator (scripts/make_tv_bracket_fixture.py) - die gemischte Runde (#1548) als Grundlage.
import TVG from "../../e2e/fixtures/tvGenerated.json";
import { MOMENT_PRIORITY, createMomentQueue, drawReadyText, momentsFromChange, readyDraws } from "./tvMoments";

// Show-Auslosung und „sofort zufällig“ am TV (#1634): „Auslosung bereit“ ist ein eigener Moment (und steht danach, bis
// gelost ist), ein sofort gezogener Platz ist ein kurzer eigener Moment - beides aus dem Vergleich alter/neuer Stand,
// wie die übrigen Momente, genau einmal.

const state = (name) => structuredClone(TVG[name]);
const idOf = (bracket, key) => bracket.matches_v2.find((match) => match.match_key === key).id;
const SINCE = "2026-10-31T15:00:00+00:00";

/** Die Zielspiele der Gruppe WB:2 im Modus `mode`, auf Wunsch mit dem Marker „bereit“ (wie der Server ihn setzt). */
function withMode(bracket, mode, { ready = false } = {}) {
  for (const match of bracket.matches_v2) {
    if (match.settings?.draw_group !== "WB:2") continue;
    match.settings = { ...match.settings, advancement_mode: mode };
    if (ready) match.draw_ready = { group: "WB:2", since: SINCE, pot_size: 4 };
  }
  return bracket;
}

/** Sofort zufällig: genau ein Platz von E ist gezogen - mit Los-Kennung und Herkunft wie am Server. */
function oneAssigned() {
  const before = withMode(state("se8_mixed_before_draw"), "instant");
  const after = structuredClone(before);
  const drawn = state("se8_mixed_drawn").matches_v2.find((match) => match.match_key === "E").slots[0];
  const target = after.matches_v2.find((match) => match.match_key === "E");
  target.slots[0] = { ...target.slots[0], registration_id: drawn.registration_id, status: "filled", source_result: drawn.source_result };
  return { before, after, registrationId: drawn.registration_id };
}

describe("Show-Auslosung bereit (draw_ready)", () => {
  it("die Runde ist fertig, der Topf steht: ein Moment mit den Zielspielen und der Zahl der Namen", () => {
    const before = withMode(state("se8_mixed_before_draw"), "draw_show");
    const after = withMode(state("se8_mixed_before_draw"), "draw_show", { ready: true });
    const { moments } = momentsFromChange(before.matches_v2, after.matches_v2);
    expect(moments).toHaveLength(1);
    const [ready] = moments;
    expect(ready.type).toBe("draw_ready");
    expect(new Set(ready.matchIds)).toEqual(new Set([idOf(after, "E"), idOf(after, "F")]));
    expect(ready.draws).toHaveLength(1);
    expect(ready.draws[0].names).toBe(4);
    expect(drawReadyText(ready.draws)).toBe("Auslosung bereit · 4 Namen");
  });

  it("genau einmal - und nicht beim ersten Laden oder wenn die Runde schon vorher bereit war", () => {
    const before = withMode(state("se8_mixed_before_draw"), "draw_show");
    const after = withMode(state("se8_mixed_before_draw"), "draw_show", { ready: true });
    const seen = new Set();
    expect(momentsFromChange(before.matches_v2, after.matches_v2, { seen }).moments).toHaveLength(1);
    expect(momentsFromChange(before.matches_v2, after.matches_v2, { seen }).moments).toEqual([]);
    expect(momentsFromChange(null, after.matches_v2).moments).toEqual([]);
    expect(momentsFromChange(after.matches_v2, structuredClone(after.matches_v2)).moments).toEqual([]);
  });

  it("der stehende Hinweis kommt aus den Daten: bereit, bis gelost ist - danach die Auslosung als eigener Moment", () => {
    const ready = withMode(state("se8_mixed_before_draw"), "draw_show", { ready: true });
    expect(readyDraws(ready.matches_v2)).toHaveLength(1);
    const drawn = withMode(state("se8_mixed_drawn"), "draw_show");
    expect(readyDraws(drawn.matches_v2)).toEqual([]);
    const { moments } = momentsFromChange(ready.matches_v2, drawn.matches_v2);
    expect(moments.map((moment) => moment.type)).toEqual(["draw"]);
  });

  it("nur die Show kennt „bereit“ - ein alter Marker in anderen Modi zählt nicht", () => {
    const round = withMode(state("se8_mixed_before_draw"), "draw_round", { ready: true });
    expect(readyDraws(round.matches_v2)).toEqual([]);
    expect(drawReadyText([])).toBe("Auslosung bereit");
    expect(drawReadyText([{ names: 8 }, { names: 8 }])).toBe("Auslosung bereit · 2 Runden · 16 Namen");
  });
});

describe("Sofort zufällig (draw_assigned)", () => {
  it("ein Ergebnis besetzt einen Platz: ein kurzer eigener Moment mit der Zeile und ihrer Herkunft - keine Auslosung", () => {
    const { before, after, registrationId } = oneAssigned();
    const { moments } = momentsFromChange(before.matches_v2, after.matches_v2);
    expect(moments.map((moment) => moment.type)).toEqual(["draw_assigned"]);
    const [assigned] = moments;
    expect(assigned.rows).toHaveLength(1);
    expect(assigned.rows[0]).toMatchObject({ matchId: idOf(after, "E"), registrationId, slotIndex: 0, index: 0 });
    const origin = after.matches_v2.find((match) => match.match_key === "E").slots[0].source_result.from_match_key;
    expect(assigned.rows[0].from.matchId).toBe(idOf(after, origin));
  });

  it("die Reihenfolge: nach Ergebnis und Sieger, vor dem Start-Zoom - wie die Auslosung", () => {
    for (const type of ["draw_ready", "draw_assigned"]) {
      expect(MOMENT_PRIORITY[type]).toBeLessThan(MOMENT_PRIORITY.result);
      expect(MOMENT_PRIORITY[type]).toBeGreaterThan(MOMENT_PRIORITY.live);
    }
    const queue = createMomentQueue();
    queue.enqueue({ type: "live", matchIds: ["x"] });
    queue.enqueue({ type: "draw_assigned", rows: [] });
    queue.enqueue({ type: "result", items: ["y"] });
    expect(queue.next().type).toBe("result");
    queue.finish();
    expect(queue.next().type).toBe("draw_assigned");
  });
});
