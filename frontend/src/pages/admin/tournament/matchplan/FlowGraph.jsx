import { useMemo } from "react";
import { flowLayout, relatedOf } from "@/lib/matchFlow";
import { formatBracketSection, formatRoundName } from "@/lib/tournamentLabels";
import { viennaTime } from "@/lib/vienna";

// „Wer wartet auf wen“ (#1557): die Abhängigkeiten als Ablauf von links nach rechts. Durchgezogen kommt weiter,
// gestrichelt fällt ins Loser Bracket; ein Spiel, dessen Spieler noch nicht feststehen (Prognose), hat einen
// gestrichelten Rahmen. Antippen hebt hervor, was das Spiel braucht und wer danach darauf wartet.

const SIZE = { columnWidth: 176, nodeWidth: 140, nodeHeight: 56, gap: 12, top: 28 };
const hm = (ms) => viennaTime(ms, { hour: "2-digit", minute: "2-digit" }) || "–";

function columnTitle(depth) {
  if (depth === 0) return "Start";
  return depth === 1 ? "nach 1 Spiel" : `nach ${depth} Spielen`;
}

export function FlowGraph({ graph, itemsById, laneNames = {}, selectedId = null, onSelect }) {
  const layout = useMemo(() => flowLayout(graph, SIZE), [graph]);
  const related = selectedId ? relatedOf(graph, selectedId) : null;
  const near = related ? new Set([selectedId, ...related.needs, ...related.next]) : null;
  const keyOf = (id) => graph.nodes.find((node) => node.id === id)?.key || "?";
  const width = Math.max(layout.width - (SIZE.columnWidth - SIZE.nodeWidth), SIZE.nodeWidth);
  const height = layout.height + 4;

  const edgePath = (edge) => {
    const from = layout.positions[edge.from];
    const to = layout.positions[edge.to];
    if (!from || !to) return null;
    const offset = edge.kind === "L" ? 6 : -6;
    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2 + offset;
    const x2 = to.x;
    const y2 = to.y + to.height / 2 + offset;
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  };

  const selected = selectedId ? graph.nodes.find((node) => node.id === selectedId) : null;
  const selectedItem = selected ? itemsById[selected.id] : null;
  const sortKeys = (ids) => ids.map(keyOf).sort((a, b) => a.localeCompare(b, "de", { numeric: true }));

  return (
    <div className="mp-flow-wrap">
      <div className="mp-flow-scroll">
        <div className="mp-flow" data-testid="mp-flow" style={{ width: `${width}px`, height: `${height}px` }}>
          {Array.from({ length: layout.columns }, (_, depth) => (
            <span key={depth} className="mp-flow__col" aria-hidden="true" style={{ transform: `translate3d(${depth * SIZE.columnWidth}px, 0, 0)` }}>
              {columnTitle(depth)}
            </span>
          ))}
          <svg className="mp-flow__edges" width={width} height={height} aria-hidden="true">
            {graph.edges.map((edge) => {
              const d = edgePath(edge);
              if (!d) return null;
              const lit = near ? (edge.from === selectedId || edge.to === selectedId) : null;
              return <path key={`${edge.from}-${edge.to}-${edge.kind}`} d={d} className="mp-edge" data-kind={edge.kind} data-lit={lit === null ? undefined : String(lit)} />;
            })}
          </svg>
          {graph.nodes.map((node) => {
            const box = layout.positions[node.id];
            const item = itemsById[node.id];
            const when = item?.start ? `${hm(item.start)}–${hm(item.end)}` : "noch ohne Zeit";
            const station = item && item.laneId !== "none" ? laneNames[item.laneId] : "";
            return (
              <button
                key={node.id}
                type="button"
                className="mp-node"
                data-tone={item?.tone || "main"}
                data-state={item?.state || "open"}
                data-forecast={item?.forecast ? "true" : undefined}
                data-conflict={item?.conflicts?.length ? "true" : undefined}
                data-selected={selectedId === node.id ? "true" : undefined}
                data-dim={near && !near.has(node.id) ? "true" : undefined}
                aria-pressed={selectedId === node.id}
                aria-label={`${node.key}, ${when}${station ? `, ${station}` : ""}`}
                style={{ transform: `translate3d(${box.x}px, ${box.y}px, 0)`, width: `${box.width}px`, height: `${box.height}px` }}
                onClick={() => onSelect?.(selectedId === node.id ? null : node.id)}
              >
                <span className="mp-node__key">{node.key}</span>
                <span className="mp-node__time">{when}</span>
              </button>
            );
          })}
        </div>
      </div>
      <div className="mp-flow__detail" data-testid="mp-flow-detail" aria-live="polite">
        {!selected ? (
          <span className="text-white/55">Tippe auf ein Spiel: dann siehst du, auf welche Spiele es wartet und welche danach darauf warten.</span>
        ) : (
          <>
            <div>
              <strong className="text-white">{selected.key}</strong>
              {selected.section ? ` · ${formatBracketSection(selected.section)}` : ""}
              {selectedItem?.roundName ? ` · ${formatRoundName(selectedItem.roundName, selected.round)}` : ""}
              {selectedItem?.start ? ` · ${hm(selectedItem.start)}–${hm(selectedItem.end)}` : " · noch ohne Zeit"}
              {selectedItem && selectedItem.laneId !== "none" ? ` · ${laneNames[selectedItem.laneId] || ""}` : ""}
            </div>
            <div>
              Braucht: {related.needs.length
                ? sortKeys(related.needs).map((key) => {
                  const id = graph.nodes.find((node) => node.key === key)?.id;
                  const end = itemsById[id]?.end;
                  return end ? `${key} (bis ${hm(end)})` : key;
                }).join(", ")
                : "nichts - kann sofort beginnen"}
            </div>
            {selectedItem?.names?.length ? <div>Plätze: {selectedItem.names.join(" · ")}</div> : null}
            <div>Danach warten: {related.next.length ? sortKeys(related.next).join(", ") : "niemand - das ist das letzte Spiel"}</div>
            {selectedItem?.conflicts?.map((conflict) => <div key={conflict.text} className="text-warn">{conflict.text}</div>)}
          </>
        )}
      </div>
    </div>
  );
}
