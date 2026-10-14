import fs from "fs";
import path from "path";
import type { BracketMatch } from "./bracketGraph";
import { MAX_MOVES, motionPlan, wonJustNow } from "./bracketMotion";

// Bewegung im Baum (#1563): ausgelöst vom Vergleich alter/neuer Stand beim Live-Nachladen - sparsam und genau einmal.
// Kein Nachholen: der erste Stand, eine verdeckte Seite und Riesen-Sprünge springen sofort ans Ende.
type Tree = { matches_v2: BracketMatch[]; registrations: Array<{ id: string; display_name: string }>; stages: any[] };
const TREES: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/bracket-trees.json"), "utf8"));
const key = (state: string, matchKey: string) => TREES[state].matches_v2.find((match) => match.match_key === matchKey)!.id;
const reg = (state: string, name: string) => TREES[state].registrations.find((row) => row.display_name === name)!.id;

test("frisches Ergebnis und Weiterkommen nach Runde 1", () => {
  const plan = motionPlan(TREES.ffa16.matches_v2, TREES.ffa16_round1.matches_v2, { active: true })!;
  expect([...plan.results].sort()).toEqual(["A", "B", "C", "D"].map((k) => key("ffa16_round1", k)).sort());
  const arrivals = plan.rows.get(key("ffa16_round1", "E"))!;
  expect([...arrivals.keys()]).toEqual(["NeonFalke", "PixelPaula", "SchnellSchnecke", "DriftDaniel"].map((name) => reg("ffa16_round1", name)));
  // Nacheinander, aber knapp: 60 ms Versatz, höchstens acht Stufen.
  expect([...arrivals.values()].map((row) => row.delay)).toEqual([0, 60, 120, 180]);
  expect([...plan.rows.get(key("ffa16_round1", "F"))!.values()].map((row) => row.delay)).toEqual([240, 300, 360, 420]);
});

test("zusammengelegt: die Namen kommen in den Sammellauf, die alten Läufe verblassen", () => {
  const plan = motionPlan(TREES.ffa8_before_merge.matches_v2, TREES.ffa8_after_merge.matches_v2, { active: true })!;
  expect([...plan.rows.get(key("ffa8_after_merge", "A"))!.values()].every((row) => row.type === "merge")).toBe(true);
  expect([...plan.fates].sort()).toEqual(["C", "D", "F", "G"].map((k) => key("ffa8_after_merge", k)).sort());
});

test("kampflos markiert das Spiel", () => {
  const plan = motionPlan(TREES.se6_live.matches_v2, TREES.se6_done.matches_v2, { active: true })!;
  expect([...plan.walkovers]).toEqual([key("se6_done", "F")]);
});

test("kein Nachholen: erster Stand, verdeckt, Riesen-Sprung", () => {
  expect(motionPlan(null, TREES.ffa16.matches_v2, { active: true })).toBeNull();
  expect(motionPlan(TREES.ffa16.matches_v2, TREES.ffa16_round1.matches_v2, { active: false })).toBeNull();
  expect(motionPlan(TREES.ffa16.matches_v2, TREES.ffa16.matches_v2, { active: true })).toBeNull();
  const many = TREES.ffa40.matches_v2.map((match) => ({ ...match, status: "completed", results: (match.slots || []).map((slot, index) => ({ registration_id: slot.registration_id, rank: index + 1 })) }));
  expect(MAX_MOVES).toBeLessThan(40);
  expect(motionPlan(TREES.ffa40.matches_v2, many, { active: true })).toBeNull();
});

test("Turniersieg genau dann, wenn das Finale gerade für dich entschieden wurde", () => {
  const mine = reg("se6_done", "NeonFalke");
  expect(wonJustNow(TREES.se6_live.matches_v2, TREES.se6_done.matches_v2, mine, TREES.se6_done.stages)).toBe(true);
  expect(wonJustNow(TREES.se6_live.matches_v2, TREES.se6_done.matches_v2, reg("se6_done", "KartKönigin"), TREES.se6_done.stages)).toBe(false);
  expect(wonJustNow(TREES.se6_done.matches_v2, TREES.se6_done.matches_v2, mine, TREES.se6_done.stages)).toBe(false);
  expect(wonJustNow(null, TREES.se6_done.matches_v2, mine, TREES.se6_done.stages)).toBe(false);
});
