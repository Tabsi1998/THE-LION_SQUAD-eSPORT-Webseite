import fs from "fs";
import path from "path";
import { bracketEdges, finalMatchOf, type BracketMatch } from "./bracketGraph";
import { cardModel, HEAD_H, ROW_H, ROW_TALL, SINGLE_H } from "./bracketCards";
import { finderFor } from "./slotSource";

// Die Karten im Baum (#1563): was jede Karte zeigt und wie hoch sie ist - die Linien enden an der Zeile des Platzes.
type Tree = { matches_v2: BracketMatch[]; registrations: Array<{ id: string; display_name: string; status?: string }>; stages: any[] };
const TREES: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/bracket-trees.json"), "utf8"));

function setup(state: string, mine: string | null = null) {
  const tree = TREES[state];
  const regs = new Map(tree.registrations.map((reg) => [reg.id, reg]));
  const edges = bracketEdges(tree.matches_v2);
  const ctx = {
    nameOf: (id: string) => regs.get(id)?.display_name || "",
    statusOf: (id: string) => regs.get(id)?.status || "",
    finder: finderFor(tree.matches_v2),
    edges,
    matches: tree.matches_v2,
    finalId: finalMatchOf(tree.matches_v2, tree.stages)?.id || null,
    mine,
  };
  const card = (key: string) => cardModel(tree.matches_v2.find((match) => match.match_key === key)!, ctx);
  const idOf = (name: string) => tree.registrations.find((reg) => reg.display_name === name)!.id;
  return { card, idOf };
}

test("Duell: zwei Zeilen, Sieger hell, Verlierer leise, Ergebnis", () => {
  const { card } = setup("se6_done");
  const model = card("G");
  expect(model.kind).toBe("duel");
  expect(model.rows.map((row) => [row.label, row.winner, row.loser, row.result])).toEqual([["NeonFalke", true, false, "15"], ["KartKönigin", false, true, "12"]]);
  expect(model.height).toBe(HEAD_H + 2 * ROW_H);
  expect(model.anchor(2)).toBe(HEAD_H + ROW_H + ROW_H / 2);
});

test("noch offenes Duell nennt, wer kommt", () => {
  const { card } = setup("se6_live");
  expect(card("G").rows.map((row) => [row.label, row.pending])).toEqual([["Sieger aus E", true], ["Sieger aus F", true]]);
});

test("Freilos und Wertung nach Disqualifikation als eine Zeile", () => {
  const { card } = setup("se6_live");
  expect(card("A")).toMatchObject({ kind: "bye", height: SINGLE_H, line: { tag: "Freilos", text: "NeonFalke kommt weiter" } });
  expect(card("D")).toMatchObject({ kind: "bye", line: { tag: "kampflos", text: "BoostBerta kommt weiter" } });
});

test("kampflos entschieden: Schild am Sieger, der Ausgefallene durchgestrichen", () => {
  const { card } = setup("se6_done");
  const model = card("F");
  expect(model.walkover).toBe(true);
  expect(model.rows.map((row) => [row.label, row.winner, row.out])).toEqual([["KartKönigin", true, false], ["BoostBerta", false, true]]);
});

test("entfällt und zusammengelegt als eine leise Zeile", () => {
  expect(setup("de4_reset_cancelled").card("GFR")).toMatchObject({ kind: "fate", height: SINGLE_H, title: "GFR", line: { text: "entfällt · nicht nötig" } });
  expect(setup("ffa8_after_merge").card("C")).toMatchObject({ kind: "fate", title: "Lauf C", line: { text: "zusammengelegt in B" } });
});

test("Lauf vor dem Start: Plätze in Reihenfolge, „2 kommen weiter“, freie Plätze als eine Zeile", () => {
  const { card } = setup("ffa8_before_merge");
  const model = card("A");
  expect(model.kind).toBe("heat");
  expect(model.rows.map((row) => row.label)).toEqual(["NeonFalke", "DriftDaniel"]);
  expect(model.text).toMatchObject({ meta: "2 Spieler · 1 kommt weiter", free: "2 Plätze frei" });
  expect(model.cutAfter).toBe(-1);
});

test("Lauf nach dem Ergebnis: nach Platz sortiert, Trennlinie nach den Weiterkommern", () => {
  const { card } = setup("ffa16_round1");
  const model = card("A");
  expect(model.rows.map((row) => [row.label, row.result, row.qualified])).toEqual([
    ["NeonFalke", "#1", true], ["SchnellSchnecke", "#2", true], ["KurvenKarl", "#3", false], ["ZickZackZoe", "#4", false],
  ]);
  expect(model.cutAfter).toBe(1);
  expect(model.text.cut).toBe("2 kommen weiter → E");
});

test("Lauf mit „nicht erschienen“ vor dem Ergebnis (#1840, wie Web #1823): nur die markierte Person durchgestrichen", () => {
  const tree = TREES.ffa16;
  const heat = tree.matches_v2.find((match) => match.match_key === "A")!;
  const ids = (heat.slots || []).map((slot) => slot.registration_id).filter(Boolean) as string[];
  const regs = new Map(tree.registrations.map((reg) => [reg.id, reg]));
  const model = (match: BracketMatch) => cardModel(match, {
    nameOf: (id: string) => regs.get(id)?.display_name || "",
    statusOf: (id: string) => regs.get(id)?.status || "",
    finder: finderFor(tree.matches_v2),
    edges: bracketEdges(tree.matches_v2),
    matches: tree.matches_v2,
    finalId: null,
    mine: null,
  });
  const marked = { ...heat, no_show_registration_ids: [ids[1]] } as BracketMatch;
  expect(ids).toHaveLength(4);
  expect(model(heat).rows.map((row) => row.out)).toEqual([false, false, false, false]);
  expect(model(marked).rows.map((row) => [row.registrationId, row.out])).toEqual(ids.map((id, index) => [id, index === 1]));
  expect(model(marked).rows.map((row) => row.result)).toEqual(["", "", "", ""]);
  // Steht ein Ergebnis, zählt die Ergebniszeile - wer doch gefahren ist, ist nicht mehr durchgestrichen.
  const played = { ...marked, status: "completed", results: ids.map((id, index) => ({ registration_id: id, rank: index + 1 })) };
  expect(model(played).rows.some((row) => row.out)).toBe(false);
});

test("Linien enden an der Zeile des Platzes, auch im Lauf", () => {
  const { card } = setup("ffa16_round1");
  const model = card("E");
  const rows = model.rows.map((row) => row.slot);
  expect(rows).toEqual([1, 2, 3, 4]);
  const first = model.anchor(1);
  expect(model.anchor(3) - first).toBe(2 * ROW_H);
  expect(first).toBeGreaterThan(HEAD_H);
  expect(model.anchor(3)).toBeLessThan(model.height);
});

test("„Du“ und lange Namen bekommen Platz", () => {
  const { card, idOf } = setup("ffa40", null);
  const all = TREES.ffa40.matches_v2.map((match) => match.match_key as string);
  const long = all.map(card).find((model) => model.rows.some((row) => row.label.startsWith("Der unglaublich lange")))!;
  expect(long.rowHeight).toBe(ROW_TALL);
  const lion = all.find((key) => card(key).rows.some((row) => row.label === "🦁 Löwenherz"))!;
  const mine = setup("ffa40", idOf("🦁 Löwenherz")).card(lion);
  expect(mine.rows.map((row) => row.mine)).toEqual(mine.rows.map((row) => row.label === "🦁 Löwenherz"));
  expect(mine.mine).toBe(true);
});

// Wie im Web-Baum (#1591, App #1633): wer kommt, in einer Zeile - „Sieger aus Runde 1“ statt „Platz aus Runde 1“ (mit
// Rundennamen vom Server bzw. aus dem Baum: „Sieger aus Viertelfinale“, siehe Screen-Test).
test("gemischt vor der Auslosung: „Sieger aus Runde 1“ statt „Sieger aus A“", () => {
  const { card } = setup("se8_mixed_open");
  expect(card("E").rows.map((row) => [row.label, row.pending])).toEqual([["Sieger aus Runde 1", true], ["Sieger aus Runde 1", true]]);
  expect(card("E").drawState).toBe("waiting");
  const drawn = setup("se8_mixed_drawn").card("E");
  expect(drawn.rows.every((row) => row.registrationId && !row.pending)).toBe(true);
});

// Show-Auslosung (#1590, App #1633): steht der Topf, sagen die Plätze „Auslosung bereit“ - wie Web-Baum und TV.
test("Show-Auslosung bereit: die offenen Plätze sagen „Auslosung bereit“", () => {
  const FFA = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../frontend/e2e/fixtures/ffaGenerated.json"), "utf8"));
  const matches: BracketMatch[] = FFA.se8_show_ready.matches_v2;
  const ctx = { nameOf: () => "", statusOf: () => "", finder: finderFor(matches), edges: bracketEdges(matches), matches, finalId: null, mine: null };
  const model = cardModel(matches.find((match) => match.match_key === "E")!, ctx);
  expect(model.rows.map((row) => row.label)).toEqual(["Auslosung bereit", "Auslosung bereit"]);
  expect(model.drawState).toBe("ready");
});
