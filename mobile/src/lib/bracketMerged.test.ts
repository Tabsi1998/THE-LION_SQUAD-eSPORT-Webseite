import fs from "fs";
import path from "path";
import { bracketEdges, countsAsMatch, finalMatchOf, heatFreeLine, type BracketMatch } from "./bracketGraph";
import { cardModel, LINE_H, nameLines } from "./bracketCards";
import { finderFor } from "./slotSource";

// Zusammengelegte Läufe in der App (#2459) - dieselben Fälle wie die Vitest-Tests aus #2452
// (frontend/src/components/tls/BracketTree.merged.test.jsx) auf denselben echten Bäumen
// (frontend/e2e/fixtures/mergedHeatsGenerated.json: 14 Läufe, B in A, D in C, F in E, LB in LA, LD in LC zusammengelegt).

type Tree = { tournament: { status?: string }; matches_v2: BracketMatch[]; registrations: Array<{ id: string; display_name: string; status?: string }>; stages: any[] };
const MERGED: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/e2e/fixtures/mergedHeatsGenerated.json"), "utf8"));
const FFA: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/e2e/fixtures/ffaGenerated.json"), "utf8"));

const byKey = (tree: Tree, key: string) => tree.matches_v2.find((match) => match.match_key === key) as BracketMatch;

function cards(tree: Tree, finished: boolean) {
  const regs = new Map(tree.registrations.map((reg) => [reg.id, reg]));
  const ctx = {
    nameOf: (id: string) => regs.get(id)?.display_name || "",
    statusOf: (id: string) => regs.get(id)?.status || "",
    finder: finderFor(tree.matches_v2),
    edges: bracketEdges(tree.matches_v2),
    matches: tree.matches_v2,
    finalId: finalMatchOf(tree.matches_v2, tree.stages)?.id || null,
    mine: null,
    finished,
  };
  return (key: string) => cardModel(byKey(tree, key), ctx);
}

describe("Zählung (#2459, wie countsAsMatch im Web)", () => {
  test("der echte Baum: 14 Läufe, fünf zusammengelegt - gezählt werden 9", () => {
    const done = MERGED.lb8_merged_done;
    expect(done.matches_v2).toHaveLength(14);
    expect(done.matches_v2.filter(countsAsMatch)).toHaveLength(9);
    const live = MERGED.lb8_merged_live;
    const counted = live.matches_v2.filter(countsAsMatch);
    expect(counted).toHaveLength(9);
    // Mit offenem Grand Final: 8 von 9 gespielt.
    expect(counted.filter((match) => ["completed", "forfeit", "closed"].includes(String(match.status)))).toHaveLength(8);
  });

  test("Vorschau und entfallen zählen nicht, alles andere schon", () => {
    expect(countsAsMatch({ status: "cancelled" })).toBe(false);
    expect(countsAsMatch({ status: "CANCELLED" })).toBe(false);
    expect(countsAsMatch({ status: "preview" })).toBe(false);
    expect(countsAsMatch({ status: "scheduled", is_preview: true })).toBe(false);
    expect(countsAsMatch(null)).toBe(false);
    expect(countsAsMatch({ status: "scheduled" })).toBe(true);
    expect(countsAsMatch({ status: "completed" })).toBe(true);
  });
});

describe("Läufe-Karte (#2459, Wörter wie HeatCard im Web)", () => {
  test("nach dem Ende: kein „Plätze frei“ in Lauf G, im Grand Final und in LE, LF", () => {
    const card = cards(MERGED.lb8_merged_done, true);
    expect(card("B").line?.text).toBe("zusammengelegt in A");
    expect(card("LD").line?.text).toBe("zusammengelegt in LC");
    for (const key of ["G", "FINAL", "LE", "LF"]) expect(card(key).freeLine).toBe("");
    expect(card("FINAL").text.meta).toMatch(/^2 Spieler/);
  });

  test("auch ohne den Turnier-Status: ein gefahrener Lauf zeigt keine Zeile mehr", () => {
    const card = cards(MERGED.lb8_merged_done, false);
    for (const key of ["G", "FINAL"]) expect(card(key).freeLine).toBe("");
  });

  test("vor dem Grand Final: „2 Plätze bleiben leer“ - dorthin kommt niemand mehr", () => {
    const tree = MERGED.lb8_merged_live;
    const card = cards(tree, false);
    expect(card("FINAL").freeLine).toBe("2 Plätze bleiben leer");
    // Lauf G ist schon gefahren: keine Zeile.
    expect(card("G").freeLine).toBe("");
    const all = tree.matches_v2.map((match) => card(String(match.match_key)).freeLine);
    expect(all).not.toContain("2 Plätze frei");
  });

  test("die Zeile zählt in der Höhe der Karte mit", () => {
    const withLine = cards(MERGED.lb8_merged_live, false)("FINAL");
    const without = cards(MERGED.lb8_merged_live, true)("FINAL");
    expect(withLine.height - without.height).toBe(LINE_H);
  });

  test("gemischte Runde: ein gestrichener Platz ohne Los-Kennung bleibt „frei“", () => {
    const tree = FFA.ffa8_shuffle_merged;
    const heat = byKey(tree, "E");
    expect((heat.slots || []).some((slot) => slot.source_result?.skipped && (slot.source as { draw?: unknown } | null)?.draw && !slot.source_result.draw_id)).toBe(true);
    expect(cards(tree, false)("E").freeLine).toBe("2 Plätze frei");
  });

  test("ein einzelner Platz in der Einzahl", () => {
    const match: BracketMatch = {
      id: "x", match_key: "X", match_type: "ffa", status: "scheduled",
      slots: [
        { slot: 1, registration_id: "r1", status: "filled" },
        { slot: 2, registration_id: "r2", status: "filled" },
        { slot: 3, registration_id: null, status: "bye", source_result: { skipped: true } },
      ],
    };
    expect(heatFreeLine(match)).toBe("1 Platz bleibt leer");
    expect(heatFreeLine({ ...match, slots: [match.slots![0], match.slots![1], { slot: 3, registration_id: null, status: "bye" }] })).toBe("1 Platz frei");
    expect(heatFreeLine(match, { finished: true })).toBe("");
  });
});

describe("Namen in der Karte (#2459, wie im Web #2452)", () => {
  test("ein Wort bricht nie mitten im Wort um: eine Zeile mit „…“; mehrere Wörter dürfen umbrechen", () => {
    expect(nameLines("KartKöniginDerHerzenAusTirol", true)).toBe(1);
    expect(nameLines("  KartKönigin  ", true)).toBe(1);
    expect(nameLines("Der sehr lange Name aus Tirol", true)).toBe(2);
    expect(nameLines("Kurz", false)).toBe(1);
  });
});
