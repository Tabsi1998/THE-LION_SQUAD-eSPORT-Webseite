import { createPortal } from "react-dom";
import { boxFree, overflows } from "../cardDeco";
import { useCardDeco, useCardReaction } from "../useCardDeco";
import { CARD_STREAMER, cardStreamerPlan, loopDelay } from "./cardStreamer";

// Luftschlangen an Karten (Jahreszeiten IV, Variante B, #1093): zusätzlich zu denen am oberen Seitenrand liegt auf der
// Oberkante einiger Karten, die sich heben, eine gekringelte Luftschlange; ihr Ende hängt an einer Ecke außen über die
// Kante herab. Nur wo darüber und daneben nichts Lesbares und keine andere Karte ist, nie über den Rand der Seite.
// Hebt sich die Karte, fährt sie mit und flattert einmal durch (die Schlaufen heben sich nacheinander, das Ende
// pendelt); danach liegt sie wieder wie vorher. Ohne Maus oder mit „Bewegung reduzieren“ liegt sie nur da.

/** Schmälere Karten tragen keine Luftschlange. */
export const STREAMER_MIN_WIDTH = 180;

function windowBox(rect, box) {
  return { left: rect.left + box.left, right: rect.left + box.right, top: rect.top + box.top, bottom: rect.top + box.bottom };
}

/**
 * Passt eine Luftschlange an diese Karte? Erst an der Ecke aus der Saat, dann an der anderen; hat das Ende neben der
 * Karte keinen Platz, liegt sie ohne Ende auf der Kante. Liefert die Form oder null.
 */
export function placeStreamer(anchor, { doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window, neighbours = null, seed = "streamer" } = {}) {
  const rect = anchor.rect;
  if (!rect || rect.width < STREAMER_MIN_WIDTH) return null;
  const first = cardStreamerPlan(rect.width, seed).side;
  const fits = (box) => !doc || (!overflows(doc, win, windowBox(rect, box)) && boxFree(doc, win, windowBox(rect, { ...box, bottom: Math.min(box.bottom, -1) }), anchor.element, { neighbours, step: 5 }));
  const hangs = (box) => !doc || (!overflows(doc, win, windowBox(rect, box)) && boxFree(doc, win, windowBox(rect, box), anchor.element, { neighbours, step: 5 }));
  for (const side of [first, first === "left" ? "right" : "left"]) {
    const plan = cardStreamerPlan(rect.width, seed, { side });
    if (!fits(plan.box.lying)) continue;
    const full = plan.box.hanging && hangs(plan.box.hanging) ? plan : cardStreamerPlan(rect.width, seed, { side, hang: false });
    const box = full.box.hanging
      ? { left: Math.min(full.box.lying.left, full.box.hanging.left), right: Math.max(full.box.lying.right, full.box.hanging.right), top: full.box.lying.top, bottom: full.box.hanging.bottom }
      : full.box.lying;
    return { ...full, ax: full.corner, ay: 0, box };
  }
  return null;
}

function Ribbon({ d, colors }) {
  return (
    <>
      <path d={d} stroke={colors[0]} strokeWidth={CARD_STREAMER.stroke} fill="none" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
      <path d={d} stroke={colors[1]} strokeWidth="0.9" fill="none" strokeLinecap="round" strokeDasharray="3 5" vectorEffect="non-scaling-stroke" />
    </>
  );
}

function CardStreamer({ item, reaction }) {
  const plan = item.geo;
  const box = plan.box;
  const width = box.right - box.left;
  const height = box.bottom - box.top;
  const flutter = Boolean(reaction);
  return (
    <svg
      className={`tls-cstreamer${item.yield ? " tls-cstreamer--yield" : ""}`}
      style={{ left: `${(item.x + box.left).toFixed(1)}px`, top: `${(item.y + box.top).toFixed(1)}px`, width: `${width}px`, height: `${height}px` }}
      width={width}
      height={height}
      viewBox={`${box.left} ${box.top} ${width} ${height}`}
      aria-hidden="true"
      data-testid="carnival-card-streamer"
      data-season-card={item.card}
      data-side={plan.side}
      data-hang={plan.hang ? "1" : undefined}
      data-flutter={flutter ? "1" : undefined}
      data-yield={item.yield ? "1" : undefined}
    >
      {/* Je Flattern eine neue Gruppe: so beginnt die Animation jedes Mal von vorn. */}
      <g key={reaction ? reaction.n : "rest"} className={flutter ? "tls-cstreamer__rig tls-cstreamer--flutter" : "tls-cstreamer__rig"}>
        {plan.hang ? (
          <g className="tls-cstreamer__hang" style={{ transformOrigin: `${plan.hang.x}px 0px`, "--swing": `${plan.swing}deg` }}>
            <Ribbon d={plan.hang.d} colors={plan.colors} />
          </g>
        ) : null}
        {plan.loops.map((loop) => (
          <g key={loop.index} className="tls-cstreamer__loop" style={{ transformOrigin: `${loop.x}px 0px`, "--delay": `${loopDelay(loop.index)}ms` }}>
            <Ribbon d={loop.d} colors={plan.colors} />
          </g>
        ))}
      </g>
    </svg>
  );
}

/** Luftschlangen an Karten - liegen auch bei „dezent“, flattern nur mit Maus und Bewegung. */
export function CardStreamers({ season }) {
  const { items, itemsRef } = useCardDeco({ season, kind: "streamer", place: placeStreamer });
  const reactions = useCardReaction(itemsRef, { durationMs: CARD_STREAMER.ms, enabled: items.length > 0 });
  if (typeof document === "undefined" || !items.length) return null;
  return createPortal(
    <div className="tls-card-deco tls-card-streamers" aria-hidden="true" data-testid="carnival-card-streamers">
      {items.map((item) => <CardStreamer key={item.id} item={item} reaction={reactions[item.id] || null} />)}
    </div>,
    document.body,
  );
}
