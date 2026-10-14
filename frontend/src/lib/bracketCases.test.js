import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { finalMatchOf } from "./bracketPodium";
import {
  bracketEdges, diffBracket, drawRails, heatExits, heatText, isWalkover, matchFate, orderEdges, pathFor, sectionGroup, soloAdvance,
} from "./bracketGraph";

// Gemeinsame Erwartungen für Website, App und TV (#1561, #1563, #1564): docs/bracket-cases.json auf den echten Bäumen aus
// docs/bracket-trees.json (scripts/make_app_bracket_fixture.py). Die App prüft dieselben Fälle in
// mobile/src/lib/bracketGraph.test.ts - so rechnen alle gleich, auch bei gemischten Runden (#1548).

const root = path.join(process.cwd(), "..");
const TREES = JSON.parse(readFileSync(path.join(root, "docs/bracket-trees.json"), "utf8"));
const CASES = JSON.parse(readFileSync(path.join(root, "docs/bracket-cases.json"), "utf8"));

function helpers(state) {
  const tree = TREES[state];
  const keyOf = new Map(tree.matches_v2.map((match) => [match.id, match.match_key]));
  const byKey = new Map(tree.matches_v2.map((match) => [match.match_key, match]));
  const nameOf = new Map(tree.registrations.map((reg) => [reg.id, reg.display_name]));
  const idOf = new Map(tree.registrations.map((reg) => [reg.display_name, reg.id]));
  const edgeText = (edge, flags = true) =>
    [`${keyOf.get(edge.from)}>${keyOf.get(edge.to)}:${edge.toSlot}${flags ? ` ${edge.flow}` : ""}`, flags && edge.cross ? "quer" : "", flags && edge.void ? "entfällt" : ""].filter(Boolean).join(" ");
  return { tree, keyOf, byKey, nameOf, idOf, edgeText };
}

describe("gemeinsame Fälle (docs/bracket-cases.json)", () => {
  it.each(CASES.edges)("Linien aus den Quellen: $state", ({ state, edges }) => {
    const { tree, edgeText } = helpers(state);
    expect(bracketEdges(tree.matches_v2).map((edge) => edgeText(edge)).sort()).toEqual([...edges].sort());
  });

  it.each(CASES.fate)("Was mit einem Spiel geschah: $state", ({ state, fates }) => {
    const { tree } = helpers(state);
    for (const match of tree.matches_v2) expect([match.match_key, matchFate(match)]).toEqual([match.match_key, fates[match.match_key] || null]);
  });

  it.each(CASES.soloAdvance)("Freilos-Duell als eine Zeile: $state", ({ state, solo }) => {
    const { tree, nameOf } = helpers(state);
    for (const match of tree.matches_v2) {
      const advance = soloAdvance(match);
      expect([match.match_key, advance ? nameOf.get(advance.slot.registration_id) : null]).toEqual([match.match_key, solo[match.match_key] || null]);
    }
  });

  it.each(CASES.walkover)("kampflos: $state", ({ state, walkover }) => {
    const { tree } = helpers(state);
    expect(tree.matches_v2.filter(isWalkover).map((match) => match.match_key)).toEqual(walkover);
  });

  it.each(CASES.heatExits)("Wohin ein Lauf führt: $state", ({ state, exits }) => {
    const { tree, byKey } = helpers(state);
    const edges = bracketEdges(tree.matches_v2);
    for (const [key, expected] of Object.entries(exits)) expect(heatExits(byKey.get(key), edges, tree.matches_v2)).toEqual(expected);
  });

  it.each(CASES.path)("Dein Weg: $player in $state", ({ state, player, matches, edges, ahead }) => {
    const { tree, keyOf, idOf, edgeText } = helpers(state);
    const all = bracketEdges(tree.matches_v2);
    const result = pathFor(idOf.get(player), tree.matches_v2, all);
    expect([...result.matches].map((id) => keyOf.get(id)).sort()).toEqual([...matches].sort());
    expect(all.filter((edge) => result.edges.has(edge.id)).map((edge) => edgeText(edge, false)).sort()).toEqual([...edges].sort());
    expect([...(result.ahead || [])].map((id) => keyOf.get(id)).sort()).toEqual([...ahead].sort());
  });

  it.each(CASES.finalMatch)("Das entscheidende Spiel: $state", ({ state, final }) => {
    const { tree } = helpers(state);
    expect(finalMatchOf(tree.matches_v2, tree.stages)?.match_key ?? null).toBe(final);
  });

  it.each(CASES.diff)("Bewegungen von $from nach $to", ({ from, to, events }) => {
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

  it.each(CASES.heatText)("Lauf-Karte $match in $state", ({ state, match, text }) => {
    const { tree, byKey } = helpers(state);
    const edges = bracketEdges(tree.matches_v2);
    const final = finalMatchOf(tree.matches_v2, tree.stages);
    expect(heatText(byKey.get(match), edges, tree.matches_v2, final?.id || null)).toEqual(text);
  });

  it.each(CASES.rails)("Sammelschiene je gemischter Gruppe: $state", ({ state, rails }) => {
    const { tree, keyOf } = helpers(state);
    expect(drawRails(tree.matches_v2).map((rail) => ({
      group: rail.group,
      label: rail.label,
      sources: rail.sources.map((source) => `${keyOf.get(source.id)} ${source.flow}`).sort(),
      targets: rail.targets.map((id) => keyOf.get(id)).sort(),
      drawn: rail.drawn,
    }))).toEqual(rails);
  });

  it.each(["se8_mixed_open", "se8_mixed_drawn", "de8_mixed_r1", "ffa16_mixed_open", "ffa16_mixed_drawn"])("gemischt: Linien nur aus der echten Herkunft - %s", (state) => {
    const { tree, keyOf, byKey } = helpers(state);
    const expected = [];
    for (const match of tree.matches_v2) {
      for (const slot of match.slots || []) {
        if (!slot.source?.draw) continue;
        const from = slot.source_result?.from_match_key;
        if (slot.registration_id && from) expected.push(`${byKey.get(from)?.match_key}>${match.match_key}:${slot.slot}`);
      }
    }
    const all = bracketEdges(tree.matches_v2);
    expect(all.filter((edge) => edge.rail).map((edge) => `${keyOf.get(edge.from)}>${keyOf.get(edge.to)}:${edge.toSlot}`).sort()).toEqual(expected.sort());
    const targets = new Set(tree.matches_v2.filter((match) => match.settings?.draw_group).map((match) => match.id));
    expect(all.filter((edge) => targets.has(edge.to) && !edge.rail)).toEqual([]);
  });

  it.each(CASES.railsPerPhase || [])("Schienen je Phase getrennt: $state", ({ state, rails, path: expectedPath }) => {
    const { tree, idOf } = helpers(state);
    const tag = (id) => (id ? `${id}#2` : id);
    const copy = structuredClone(tree.matches_v2).map((match) => ({
      ...match, id: tag(match.id), stage_id: "phase-2",
      advancement: (match.advancement || []).map((entry) => ({ ...entry, to_match_id: tag(entry.to_match_id) })),
      slots: (match.slots || []).map((slot) => ({ ...slot, registration_id: tag(slot.registration_id), source_result: slot.source_result ? { ...slot.source_result, from_match_id: tag(slot.source_result.from_match_id) } : slot.source_result })),
      results: (match.results || []).map((row) => ({ ...row, registration_id: tag(row.registration_id) })),
      winner_id: tag(match.winner_id),
    }));
    const matches = [...tree.matches_v2, ...copy];
    const keyOf = new Map(matches.map((match) => [match.id, match.match_key]));
    const phaseOf = (id) => (String(id).endsWith("#2") ? 2 : 1);
    const all = drawRails(matches);
    expect(all.map((rail) => ({
      phase: phaseOf(rail.targets[0]),
      group: rail.group,
      sources: rail.sources.map((source) => `${keyOf.get(source.id)} ${source.flow}`).sort(),
      targets: rail.targets.map((id) => keyOf.get(id)).sort(),
      drawn: rail.drawn,
    })).sort((a, b) => a.phase - b.phase)).toEqual(rails);
    const player = idOf.get(expectedPath.player);
    const result = pathFor(expectedPath.phase === 2 ? tag(player) : player, matches, bracketEdges(matches));
    const railOf = new Map(all.map((rail) => [rail.key, rail]));
    expect([...(result.rails || [])].map((entry) => {
      const rail = [...railOf.values()].find((candidate) => entry.startsWith(`${candidate.key}:`));
      const source = entry.slice(rail.key.length + 1);
      return `${phaseOf(rail.targets[0])} ${rail.group}:${keyOf.get(source)}`;
    })).toEqual(expectedPath.rails);
  });

  it("der erste Stand bewegt nichts, jede Bewegung hat einen eigenen Schlüssel", () => {
    const { tree } = helpers("ffa16_round1");
    expect(diffBracket(null, tree.matches_v2)).toEqual([]);
    const events = diffBracket(TREES.ffa16.matches_v2, tree.matches_v2);
    expect(new Set(events.map((event) => event.key)).size).toBe(events.length);
  });

  it("alte Bäume ohne Herkunft: Linien nach der Reihenfolge", () => {
    const matches = helpers("se6_live").tree.matches_v2.map((match) => ({ ...match, advancement: [], slots: (match.slots || []).map((slot) => ({ ...slot, source: null })) }));
    expect(bracketEdges(matches)).toEqual([]);
    const rounds = [1, 2, 3].map((round) => matches.filter((match) => match.round === round));
    expect(orderEdges(rounds).map((edge) => `${matches.find((m) => m.id === edge.from)?.match_key}>${matches.find((m) => m.id === edge.to)?.match_key}`))
      .toEqual(["A>E", "B>E", "C>F", "D>F", "E>G", "F>G"]);
  });

  it("Abschnitte wie am Server", () => {
    expect(["WB", "main", undefined].map(sectionGroup)).toEqual(["main", "main", "main"]);
    expect(["LB", "loser", "GF", "grand_final", "bronze"].map(sectionGroup)).toEqual(["loser", "loser", "final", "final", "bronze"]);
  });
});
