// „Wer wartet auf wen“ (#1557): die Abhängigkeiten der Spiele als Graph - so, wie der Planer sie liest
// (services/match_scheduler.py: Platz-Herkunft; gemischte Runden: alle Quellspiele der Auslosungs-Gruppe,
// services/advancement_draw.prerequisite_ids). Kanten kommen aus den Weiterleitungen (`advancement`), sonst aus der
// Herkunft der Plätze. Die Spalte eines Spiels ist die längste Kette davor.

const SECTION_ORDER = { WB: 0, winner: 0, MAIN: 0, LB: 1, loser: 1, GF: 2, FINAL: 2, grand_final: 2 };

function sectionRank(section) {
  return SECTION_ORDER[section] ?? 1.5;
}

function drawGroupOf(match) {
  const value = match?.settings?.draw_group;
  return value ? String(value) : null;
}

/** Knoten und Kanten. Vorschau-Spiele zählen nur, wenn es keine echten gibt (wie beim Planer). */
export function dependencyGraph(matches = []) {
  const all = (matches || []).filter(Boolean);
  const real = all.filter((match) => !match.is_preview);
  const rows = real.length ? real : all;
  const byId = new Map(rows.map((match) => [match.id, match]));
  const byStageKey = new Map(rows.filter((match) => match.match_key).map((match) => [`${match.stage_id || ""}::${match.match_key}`, match]));
  const edges = new Map();
  const add = (from, to, kind) => {
    if (!from || !to || from === to || !byId.has(from) || !byId.has(to)) return;
    const key = `${from}>${to}>${kind}`;
    if (!edges.has(key)) edges.set(key, { from, to, kind });
  };

  for (const match of rows) {
    for (const entry of match.advancement || []) {
      add(match.id, entry.to_match_id, entry.flow === "L" ? "L" : "W");
    }
  }
  if (!edges.size) {
    for (const match of rows) {
      for (const slot of match.slots || []) {
        const source = slot?.source;
        if (source?.type !== "rank" || !source.match_key) continue;
        const from = byStageKey.get(`${match.stage_id || ""}::${source.match_key}`);
        add(from?.id, match.id, source.flow === "L" ? "L" : "W");
      }
    }
  }
  // Gemischte Runde (#1548): ein Folgespiel einer Auslosungs-Gruppe wartet auf alle Spiele, die in die Gruppe leiten.
  const groups = new Map();
  for (const match of rows) {
    const group = drawGroupOf(match);
    if (group) groups.set(group, [...(groups.get(group) || []), match.id]);
  }
  for (const targets of groups.values()) {
    const targetSet = new Set(targets);
    const feeding = [...edges.values()].filter((edge) => targetSet.has(edge.to) && !targetSet.has(edge.from));
    for (const edge of feeding) for (const target of targets) add(edge.from, target, edge.kind);
  }

  const list = [...edges.values()];
  const incoming = new Map();
  for (const edge of list) incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge.from]);
  const depth = new Map();
  const depthOf = (id, trail = new Set()) => {
    if (depth.has(id)) return depth.get(id);
    if (trail.has(id)) return 0;
    const next = new Set(trail).add(id);
    const before = incoming.get(id) || [];
    const value = before.length ? 1 + Math.max(...before.map((item) => depthOf(item, next))) : 0;
    depth.set(id, value);
    return value;
  };
  const nodes = rows.map((match) => ({
    id: match.id,
    key: match.match_key || match.round_name || "Spiel",
    section: match.section || "",
    round: match.round,
    order: Number(match.order) || 0,
    status: match.status,
    depth: depthOf(match.id),
  }));
  return { nodes, edges: list };
}

/** Was ein Spiel braucht (direkte Vorspiele) und wer direkt darauf wartet. */
export function relatedOf(graph, id) {
  const needs = [...new Set(graph.edges.filter((edge) => edge.to === id).map((edge) => edge.from))];
  const next = [...new Set(graph.edges.filter((edge) => edge.from === id).map((edge) => edge.to))];
  return { needs, next };
}

/** Lage je Knoten: Spalten nach Tiefe, in der Spalte Winner vor Loser vor Finale, mittig ausgerichtet. */
export function flowLayout(graph, { columnWidth = 170, nodeWidth = 136, nodeHeight = 56, gap = 12, top = 24 } = {}) {
  const columns = new Map();
  for (const node of graph.nodes) columns.set(node.depth, [...(columns.get(node.depth) || []), node]);
  const tallest = Math.max(1, ...[...columns.values()].map((column) => column.length));
  const height = top + tallest * (nodeHeight + gap);
  const positions = {};
  for (const [depth, column] of columns) {
    column.sort((a, b) => sectionRank(a.section) - sectionRank(b.section) || (a.round || 0) - (b.round || 0)
      || a.order - b.order || String(a.key).localeCompare(String(b.key), "de"));
    const columnHeight = column.length * (nodeHeight + gap) - gap;
    const offset = top + (height - top - gap - columnHeight) / 2;
    column.forEach((node, index) => {
      positions[node.id] = { x: depth * columnWidth, y: Math.round(offset + index * (nodeHeight + gap)), width: nodeWidth, height: nodeHeight };
    });
  }
  const count = graph.nodes.length ? Math.max(...graph.nodes.map((node) => node.depth)) + 1 : 0;
  return { positions, width: count * columnWidth, height, columns: count };
}
