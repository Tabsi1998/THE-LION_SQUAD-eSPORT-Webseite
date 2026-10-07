import { useMemo } from "react";
import { createPortal } from "react-dom";
import { CARD_BAND, boxFree } from "../cardDeco";
import { useCardDeco, useCardReaction } from "../useCardDeco";
import { Chain, bandGaps } from "./LightChain";
import { BAND_HEIGHT, GLOW, chainLayout } from "./lights";
import { SWING, swingPlan } from "./swing";

// Lichterketten an Karten (Jahreszeiten IV, Variante B, #1091): zusätzlich zur Kette unter der Kopfzeile hängt an
// einigen Karten, die sich heben, eine kleine Kette im unteren Innenabstand - das Band beginnt 16 px über der
// Unterkante, wie an der Begrüßungskarte der App. Nie über Schrift oder Bedienung (was ins Band ragt, wird zur Lücke;
// ist zu viel Lücke, bekommt die Karte keine Kette). Hebt sich die Karte, fährt die Kette mit und schwingt nach, ein
// Licht flackert einmal; beim Loslassen dasselbe in klein. Ketten an anderen Karten bleiben still.

/** Schmälere Karten tragen keine Kette. */
export const CHAIN_MIN_WIDTH = 220;
/** So viel der Breite darf höchstens Lücke sein. */
export const MAX_GAP_SHARE = 0.34;

/**
 * Passt eine Kette an diese Karte? Das Band im unteren Innenabstand, die Lücken darin, und darunter (der Schein ragt
 * ein paar Pixel über die Unterkante) keine Schrift und keine Nachbarkarte. Liefert die Form oder null.
 */
export function placeChain(anchor, { doc = typeof document === "undefined" ? null : document, win = typeof window === "undefined" ? null : window, neighbours = null } = {}) {
  const rect = anchor.rect;
  if (!rect || rect.width < CHAIN_MIN_WIDTH || rect.height < CARD_BAND * 3) return null;
  const top = rect.bottom - CARD_BAND;
  const gaps = bandGaps(anchor.element, { top: top - 2, bottom: top + BAND_HEIGHT + GLOW, left: rect.left });
  const blocked = gaps.reduce((sum, [from, to]) => sum + Math.max(0, Math.min(rect.width, to) - Math.max(0, from)), 0);
  if (blocked > rect.width * MAX_GAP_SHARE) return null;
  const below = { left: rect.left, top: rect.bottom + 1, right: rect.right, bottom: top + BAND_HEIGHT + GLOW };
  // Unter der Karte liegt nur die Lücke zur nächsten Reihe - ein grobes Raster reicht.
  if (doc && !boxFree(doc, win, below, anchor.element, { neighbours, step: 12 })) return null;
  return { band: rect.height - CARD_BAND, gaps, ax: rect.width / 2, ay: rect.height, box: { left: 0, top: rect.height - CARD_BAND, right: rect.width, bottom: rect.height - CARD_BAND + BAND_HEIGHT + GLOW } };
}

function CardChain({ item, salt, reaction }) {
  const layout = useMemo(() => chainLayout({ width: item.width, year: salt, anchor: `card:${item.index}`, gaps: item.geo.gaps }), [item.width, salt, item.index, item.geo.gaps]);
  const swing = useMemo(() => (reaction ? { ...reaction, plan: swingPlan(layout.bulbs, `${item.key}:${reaction.n}`) } : null), [reaction, layout, item.key]);
  return <Chain chain={{ anchor: "card", fixed: false, x: item.x, y: item.y + item.geo.band, gaps: item.geo.gaps }} layout={layout} swing={swing} card={item.card} testId="christmas-card-chain" hidden={Boolean(item.yield)} />;
}

/** Ketten an Karten: `salt` ist das Jahres-Salz (je Jahr andere Ketten, innerhalb des Jahres dieselben). */
export function CardChains({ season, salt = "" }) {
  const { items, itemsRef } = useCardDeco({ season, kind: "chain", place: placeChain });
  const reactions = useCardReaction(itemsRef, { durationMs: SWING.ms, leaveMs: SWING.ms, enabled: items.length > 0 });
  if (typeof document === "undefined" || !items.length) return null;
  return createPortal(
    <div className="tls-card-deco tls-lights" aria-hidden="true" data-testid="christmas-card-chains">
      {items.map((item) => <CardChain key={item.id} item={item} salt={salt} reaction={reactions[item.id] || null} />)}
    </div>,
    document.body,
  );
}
