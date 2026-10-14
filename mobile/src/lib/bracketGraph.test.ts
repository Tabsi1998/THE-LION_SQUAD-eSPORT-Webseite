import fs from "fs";
import path from "path";
import {
  bracketEdges,
  diffBracket,
  finalMatchOf,
  heatExits,
  heatText,
  isWalkover,
  matchFate,
  orderEdges,
  pathFor,
  sectionGroup,
  soloAdvance,
  type BracketMatch,
} from "./bracketGraph";

// Der Turnierbaum als Graph (#1563): dieselben Regeln wie die Website (frontend/src/lib/bracketGraph.js, #1581) - auf
// echten Bäumen aus dem Generator (docs/bracket-trees.json, scripts/make_app_bracket_fixture.py) mit den gemeinsamen
// Erwartungen aus docs/bracket-cases.json. So rechnen App und Web gleich.

type Tree = { matches_v2: BracketMatch[]; registrations: Array<{ id: string; display_name: string; status?: string }>; stages: any[]; round_labels: Record<string, string> };
const TREES: Record<string, Tree> = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/bracket-trees.json"), "utf8"));
type Cases = {
  edges: Array<{ state: string; edges: string[] }>;
  fate: Array<{ state: string; fates: Record<string, unknown> }>;
  soloAdvance: Array<{ state: string; solo: Record<string, string> }>;
  walkover: Array<{ state: string; walkover: string[] }>;
  heatExits: Array<{ state: string; exits: Record<string, unknown> }>;
  path: Array<{ state: string; player: string; matches: string[]; edges: string[]; ahead: string[] }>;
  finalMatch: Array<{ state: string; final: string | null }>;
  diff: Array<{ from: string; to: string; events: string[] }>;
  heatText: Array<{ state: string; match: string; text: Record<string, string> }>;
};
const CASES: Cases = JSON.parse(fs.readFileSync(path.join(__dirname, "../../../docs/bracket-cases.json"), "utf8"));

function helpers(state: string) {
  const tree = TREES[state];
  const keyOf = new Map(tree.matches_v2.map((match) => [match.id, match.match_key]));
  const byKey = new Map(tree.matches_v2.map((match) => [match.match_key, match]));
  const nameOf = new Map(tree.registrations.map((reg) => [reg.id, reg.display_name]));
  const idOf = new Map(tree.registrations.map((reg) => [reg.display_name, reg.id]));
  const edgeText = (edge: { from: string; to: string; toSlot: number; flow: string; cross: boolean; void: boolean }, flags = true) =>
    [`${keyOf.get(edge.from)}>${keyOf.get(edge.to)}:${edge.toSlot}${flags ? ` ${edge.flow}` : ""}`, flags && edge.cross ? "quer" : "", flags && edge.void ? "entfällt" : ""].filter(Boolean).join(" ");
  return { tree, keyOf, byKey, nameOf, idOf, edgeText };
}

test.each(CASES.edges)("Linien aus den Quellen: $state", ({ state, edges }: { state: string; edges: string[] }) => {
  const { tree, edgeText } = helpers(state);
  expect(bracketEdges(tree.matches_v2).map((edge) => edgeText(edge)).sort()).toEqual([...edges].sort());
});

test.each(CASES.fate)("Was mit einem Spiel geschah: $state", ({ state, fates }: { state: string; fates: Record<string, unknown> }) => {
  const { tree } = helpers(state);
  for (const match of tree.matches_v2) expect([match.match_key, matchFate(match)]).toEqual([match.match_key, fates[match.match_key as string] || null]);
});

test.each(CASES.soloAdvance)("Freilos-Duell als eine Zeile: $state", ({ state, solo }: { state: string; solo: Record<string, string> }) => {
  const { tree, nameOf } = helpers(state);
  for (const match of tree.matches_v2) {
    const advance = soloAdvance(match);
    expect([match.match_key, advance ? nameOf.get(advance.slot.registration_id as string) : null]).toEqual([match.match_key, solo[match.match_key as string] || null]);
  }
});

test.each(CASES.walkover)("kampflos: $state", ({ state, walkover }: { state: string; walkover: string[] }) => {
  const { tree } = helpers(state);
  expect(tree.matches_v2.filter(isWalkover).map((match) => match.match_key)).toEqual(walkover);
});

test.each(CASES.heatExits)("Wohin ein Lauf führt: $state", ({ state, exits }: { state: string; exits: Record<string, unknown> }) => {
  const { tree, byKey } = helpers(state);
  const edges = bracketEdges(tree.matches_v2);
  for (const [key, expected] of Object.entries(exits)) expect(heatExits(byKey.get(key) as BracketMatch, edges, tree.matches_v2)).toEqual(expected);
});

test.each(CASES.path)("Dein Weg: $player in $state", ({ state, player, matches, edges, ahead }: { state: string; player: string; matches: string[]; edges: string[]; ahead: string[] }) => {
  const { tree, keyOf, idOf, edgeText } = helpers(state);
  const all = bracketEdges(tree.matches_v2);
  const result = pathFor(idOf.get(player) as string, tree.matches_v2, all);
  expect([...result.matches].map((id) => keyOf.get(id)).sort()).toEqual([...matches].sort());
  expect(all.filter((edge) => result.edges.has(edge.id)).map((edge) => edgeText(edge, false)).sort()).toEqual([...edges].sort());
  expect([...(result.ahead || [])].map((id) => keyOf.get(id)).sort()).toEqual([...ahead].sort());
});

test.each(CASES.finalMatch)("Das entscheidende Spiel: $state", ({ state, final }: { state: string; final: string | null }) => {
  const { tree } = helpers(state);
  expect(finalMatchOf(tree.matches_v2, tree.stages)?.match_key ?? null).toBe(final);
});

test.each(CASES.diff)("Bewegungen von $from nach $to", ({ from, to, events }: { from: string; to: string; events: string[] }) => {
  const before = helpers(from);
  const after = helpers(to);
  const text = diffBracket(before.tree.matches_v2, after.tree.matches_v2).map((event) => [
    event.type,
    after.keyOf.get(event.matchId),
    event.registrationId ? after.nameOf.get(event.registrationId) : event.fate,
    event.from ? after.keyOf.get(event.from.matchId) : undefined,
  ].filter(Boolean).join(":"));
  expect(text).toEqual(events);
});

test.each(CASES.heatText)("Lauf-Karte $match in $state", ({ state, match, text }: { state: string; match: string; text: Record<string, string> }) => {
  const { tree, byKey } = helpers(state);
  const edges = bracketEdges(tree.matches_v2);
  const final = finalMatchOf(tree.matches_v2, tree.stages);
  expect(heatText(byKey.get(match) as BracketMatch, edges, tree.matches_v2, final?.id || null)).toEqual(text);
});

test("der erste Stand bewegt nichts, jede Bewegung hat einen eigenen Schlüssel", () => {
  const { tree } = helpers("ffa16_round1");
  expect(diffBracket(null, tree.matches_v2)).toEqual([]);
  const events = diffBracket(TREES.ffa16.matches_v2, tree.matches_v2);
  expect(new Set(events.map((event) => event.key)).size).toBe(events.length);
});

test("alte Bäume ohne Herkunft: Linien nach der Reihenfolge", () => {
  const strip = (state: string) => helpers(state).tree.matches_v2.map((match) => ({ ...match, advancement: [], slots: (match.slots || []).map((slot) => ({ ...slot, source: null })) }));
  const matches = strip("se6_live");
  expect(bracketEdges(matches)).toEqual([]);
  const rounds = [1, 2, 3].map((round) => matches.filter((match) => match.round === round));
  expect(orderEdges(rounds).map((edge) => `${matches.find((m) => m.id === edge.from)?.match_key}>${matches.find((m) => m.id === edge.to)?.match_key}`))
    .toEqual(["A>E", "B>E", "C>F", "D>F", "E>G", "F>G"]);
});

test("Abschnitte wie am Server", () => {
  expect(["WB", "main", undefined].map(sectionGroup)).toEqual(["main", "main", "main"]);
  expect(["LB", "loser", "GF", "grand_final", "bronze"].map(sectionGroup)).toEqual(["loser", "loser", "final", "final", "bronze"]);
});
