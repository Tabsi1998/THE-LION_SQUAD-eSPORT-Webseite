import { useMemo } from "react";
import { createPortal } from "react-dom";
import { boxFree } from "../cardDeco";
import { useCardDeco, useCardReaction } from "../useCardDeco";
import { EDGE_GARLAND, PENNANT_FLUTTER, edgePennants, edgeString, pennantDelay } from "./cardGarland";

// Wimpelketten an Karten (Jahreszeiten IV, Variante B, #1094): zusätzlich zu den Ketten unter der Kopfzeile hängt im
// unteren Innenabstand einiger Karten, die sich heben, eine kleine Wimpelkette - dieselbe wie an der Begrüßungskarte der
// App. Nur wo im Band keine Schrift, kein Bild und keine Bedienung liegt. Hebt sich die Karte, fährt sie mit und
// flattert einmal durch (eine Sekunde); andere Ketten bleiben still. Ohne Maus oder mit „Bewegung reduzieren“ hängt sie
// nur da.

/** Schmälere Karten tragen keine Kette. */
export const GARLAND_MIN_WIDTH = 200;

/** Passt eine Wimpelkette an diese Karte? Das ganze Band im unteren Innenabstand muss frei sein. */
export function placeGarland(anchor, { doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window, neighbours = null } = {}) {
  const rect = anchor.rect;
  if (!rect || rect.width < GARLAND_MIN_WIDTH || rect.height < EDGE_GARLAND.band * 3) return null;
  const top = rect.bottom - EDGE_GARLAND.band;
  if (doc && !boxFree(doc, win, { left: rect.left + 2, top: top - 1, right: rect.right - 2, bottom: rect.bottom - 1 }, anchor.element, { neighbours, step: 7 })) return null;
  return { band: rect.height - EDGE_GARLAND.band, ax: rect.width / 2, ay: rect.height, box: { left: 0, top: rect.height - EDGE_GARLAND.band, right: rect.width, bottom: rect.height } };
}

function CardGarland({ item, year, reaction }) {
  const pennants = useMemo(() => edgePennants(item.width, year, `card:${item.index}`), [item.width, year, item.index]);
  const string = useMemo(() => edgeString(pennants, item.width), [pennants, item.width]);
  if (!pennants.length) return null;
  const flutter = Boolean(reaction);
  return (
    <svg
      className={`tls-cgarland${item.yield ? " tls-cgarland--yield" : ""}`}
      style={{ left: `${item.x.toFixed(1)}px`, top: `${(item.y + item.geo.band).toFixed(1)}px`, width: `${item.width}px`, height: `${EDGE_GARLAND.band}px` }}
      width={item.width}
      height={EDGE_GARLAND.band}
      viewBox={`0 0 ${item.width} ${EDGE_GARLAND.band}`}
      aria-hidden="true"
      data-testid="birthday-card-garland"
      data-season-card={item.card}
      data-pennants={pennants.length}
      data-flutter={flutter ? "1" : undefined}
      data-yield={item.yield ? "1" : undefined}
    >
      <path d={string} stroke="rgba(255, 255, 255, 0.45)" strokeWidth="0.8" fill="none" />
      {/* Je Flattern eine neue Gruppe: so beginnt die Animation jedes Mal von vorn. */}
      <g key={reaction ? reaction.n : "rest"} className={flutter ? "tls-cgarland--flutter" : undefined}>
        {pennants.map((pennant, index) => (
          <path
            key={index}
            className="tls-cgarland__pennant"
            style={{ transformOrigin: `${pennant.x}px ${pennant.y}px`, "--delay": `${pennantDelay(index, pennants.length)}ms` }}
            d={`M ${(pennant.x - pennant.size / 2).toFixed(1)} ${pennant.y} L ${(pennant.x + pennant.size / 2).toFixed(1)} ${pennant.y} L ${pennant.x} ${(pennant.y + pennant.size * 0.9).toFixed(1)} Z`}
            fill={pennant.color}
            stroke="rgba(0, 0, 0, 0.25)"
            strokeWidth="0.5"
            data-testid="birthday-card-pennant"
          />
        ))}
      </g>
    </svg>
  );
}

/** Wimpelketten an Karten; `year` ist das Jahr der Feier (gleiche Kette je Jahr und Karte). */
export function CardGarlands({ season, year }) {
  const { items, itemsRef } = useCardDeco({ season, kind: "garland", place: placeGarland });
  const reactions = useCardReaction(itemsRef, { durationMs: PENNANT_FLUTTER.ms, enabled: items.length > 0 });
  if (typeof document === "undefined" || !items.length) return null;
  return createPortal(
    <div className="tls-card-deco tls-card-garlands" aria-hidden="true" data-testid="birthday-card-garlands">
      {items.map((item) => <CardGarland key={item.id} item={item} year={year} reaction={reactions[item.id] || null} />)}
    </div>,
    document.body,
  );
}
