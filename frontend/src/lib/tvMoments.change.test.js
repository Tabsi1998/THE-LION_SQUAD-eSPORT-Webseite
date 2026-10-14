import { describe, expect, it } from "vitest";
// TV-Bäume aus dem echten Generator, Planer, Umbau und den echten Routen (scripts/make_tv_bracket_fixture.py).
import TVG from "../../e2e/fixtures/tvGenerated.json";
import { MOMENT_PRIORITY, createMomentQueue, momentsFromChange } from "./tvMoments";

// Jedes Turnier-Ereignis bekommt am TV seinen eigenen Moment (#1564) - aus dem Vergleich alter/neuer Stand
// (lib/bracketGraph.diffBracket, dieselbe Regel wie im Web-Baum): Auslosung, Läufe zusammengelegt (mit der Station, die
// frei wird), kampflos, korrigiert, entfällt. Jeder genau einmal.

const state = (name) => structuredClone(TVG[name]);
const idOf = (bracket, key) => bracket.matches_v2.find((match) => match.match_key === key).id;
// Vor der Auslosung: derselbe erzeugte Baum, nur die Setzplätze noch leer (wie im Web-Test aus #1561).
const blankSeeds = (bracket) => {
  const copy = structuredClone(bracket);
  for (const match of copy.matches_v2) for (const slot of match.slots) if (slot.source?.type === "seed") slot.registration_id = null;
  return copy;
};

describe("Momente aus dem Vergleich alter/neuer Stand", () => {
  it("Auslosung: alle neuen Namen in den Läufen als ein Moment, in Reihenfolge", () => {
    const after = state("ffa16");
    const { moments } = momentsFromChange(blankSeeds(after).matches_v2, after.matches_v2);
    expect(moments).toHaveLength(1);
    const [draw] = moments;
    expect(draw.type).toBe("draw");
    expect(draw.rows).toHaveLength(16);
    expect(draw.rows.map((row) => row.index)).toEqual([...Array(16).keys()]);
    // Jede Zeile weiß ihren Platz im Lauf - dort landet der Name.
    const first = draw.rows[0];
    const match = after.matches_v2.find((row) => row.id === first.matchId);
    expect(match.slots[first.slotIndex].registration_id).toBe(first.registrationId);
  });

  it("Läufe zusammengelegt (echter Umbau): die Namen wandern in den Sammellauf, die frei gewordenen Stationen stehen dabei", () => {
    const before = state("ffa8_before_merge");
    const after = state("ffa8_after_merge");
    const { moments } = momentsFromChange(before.matches_v2, after.matches_v2);
    const merge = moments.find((moment) => moment.type === "merge");
    expect(merge).toBeTruthy();
    expect(new Set(merge.merged)).toEqual(new Set([idOf(after, "C"), idOf(after, "D"), idOf(after, "F")]));
    expect(merge.moves).toHaveLength(4);
    for (const move of merge.moves) {
      // Woher (Zeile im alten Lauf) und wohin (Platz im Sammellauf).
      const from = before.matches_v2.find((row) => row.id === move.from.matchId);
      expect(from.slots[move.from.slotIndex].registration_id).toBe(move.registrationId);
      const to = after.matches_v2.find((row) => row.id === move.matchId);
      expect(to.slots[move.slotIndex].registration_id).toBe(move.registrationId);
    }
    // Switch 3 und 4 braucht nach dem Umbau kein offenes Spiel mehr - Switch 2 schon (Lauf B).
    expect(merge.freed).toEqual(["Switch 3", "Switch 4"]);
    // Die Namen im Sammellauf sind keine Auslosung, und „zusammengelegt“ kommt nicht doppelt als „entfällt“.
    expect(moments.some((moment) => moment.type === "draw")).toBe(false);
    expect(moments.some((moment) => moment.type === "mark")).toBe(false);
    // Die gestrichene letzte Runde (G, abgekürzt) gehört zum selben Umbau - sie tritt im selben Moment zurück.
    expect(merge.dropped).toEqual([idOf(after, "G")]);
  });

  it("kampflos: das Ergebnis trägt „kampflos“, kein eigener zweiter Moment", () => {
    const { moments, walkovers } = momentsFromChange(state("se8_corrected").matches_v2, state("se8_walkover").matches_v2);
    const walkover = state("se8_walkover").matches_v2.find((match) => match.status === "forfeit");
    expect([...walkovers]).toEqual([walkover.id]);
    expect(moments).toEqual([]);
  });

  it("korrigiert: ein geändertes Ergebnis eines schon entschiedenen Spiels", () => {
    const { corrected } = momentsFromChange(state("se8_after_a").matches_v2, state("se8_corrected").matches_v2);
    expect([...corrected]).toEqual([idOf(state("se8_corrected"), "A")]);
  });

  it("entfällt: der Reset ist nicht nötig - die Karte tritt zurück, mit Grund", () => {
    const { moments } = momentsFromChange(state("de16_before_no_reset").matches_v2, state("de16_no_reset").matches_v2);
    const mark = moments.find((moment) => moment.type === "mark");
    expect(mark).toMatchObject({ kind: "fate" });
    expect(mark.items).toEqual([{ matchId: idOf(state("de16_no_reset"), "GFR"), label: "entfällt · nicht nötig", name: "Grand Final Reset" }]);
  });

  it("genau einmal: was schon gezeigt wurde, kommt beim nächsten Vergleich nicht wieder", () => {
    const seen = new Set();
    const before = state("ffa8_before_merge").matches_v2;
    const after = state("ffa8_after_merge").matches_v2;
    expect(momentsFromChange(before, after, { seen }).moments.length).toBeGreaterThan(0);
    expect(momentsFromChange(before, after, { seen }).moments).toEqual([]);
  });

  it("Auslosung und Zusammenlegen gehen vor dem Start-Zoom, nach Ergebnis und Sieger", () => {
    expect(MOMENT_PRIORITY.draw).toBeLessThan(MOMENT_PRIORITY.result);
    expect(MOMENT_PRIORITY.merge).toBeGreaterThan(MOMENT_PRIORITY.live);
    expect(MOMENT_PRIORITY.mark).toBeGreaterThan(MOMENT_PRIORITY.live);
    const queue = createMomentQueue();
    queue.enqueue({ type: "live", matchIds: ["x"] });
    queue.enqueue({ type: "merge", moves: [] });
    expect(queue.next().type).toBe("merge");
  });
});
