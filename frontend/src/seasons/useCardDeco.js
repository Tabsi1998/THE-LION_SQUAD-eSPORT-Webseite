import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { freeSlots, neighbourRects, probeOf } from "./anchors";
import { CARD_DISTANCE, chooseDeco, cardDecoCount, decoItem, liftingCards, remeasure } from "./cardDeco";
import { REST_MS, createRest } from "./cardLift";
import { measureQuietZones, overlayZones, rectInQuiet, watchOverlays } from "./quiet";
import { seasonRng, seasonYear } from "./rng";
import { useCardSignal } from "./useCardSignal";

// Deko an Karten (Jahreszeiten IV, Variante B, #1091-#1094) in React: `useCardDeco` wählt und misst die Karten (wie die
// Netze in Kartenecken: je Fensterhöhe höchstens so viele, beim Scrollen kommen weitere dazu, unter offenen Dialogen
// weicht die Deko aus), `useCardReaction` lässt sie reagieren, wenn sich ihre Karte hebt - einmal je Anheben, höchstens
// einmal in zehn Sekunden je Karte. Das Signal kommt nur mit Maus und nie mit „Bewegung reduzieren“ (cardLift.js).

const REFRESH_DELAYS = [400, 1500, 3500];
const VIEW_MARGIN = 60;

function inView(item, win) {
  const top = win.scrollY || 0;
  return item.y + item.height >= top - VIEW_MARGIN && item.y <= top + win.innerHeight + VIEW_MARGIN;
}

/** Liegt die Deko unter einem geöffneten Dialog oder Menü? Dann blendet sie sich aus. */
function yields(item, zones) {
  const overlays = overlayZones(zones);
  if (!overlays.length) return false;
  const box = item.geo.box || { left: 0, top: 0, right: item.width, bottom: item.height };
  return rectInQuiet({ left: item.x + box.left, top: item.y + box.top, right: item.x + box.right, bottom: item.y + box.bottom }, overlays, { fixed: false, overlayOnly: true });
}

/**
 * Karten mit Deko einer Saison. `kind` trennt die Deko (Schlüssel und Saat), `place(anchor, context)` sagt, ob und wie
 * sie an diese Karte passt - mit `context` {doc, win, probe, neighbours, seed} - und liefert ihre Form (null: passt
 * nicht). `season` gibt Jahr und Stärke, `effective` darf sie überschreiben. Liefert die Einträge (je Karte einer, in
 * Seitenkoordinaten), die Liste als Ref und `update(ids, patch)` für eigene Zustände (das Ei, das gerollt ist).
 */
export function useCardDeco({ season, kind, place, enabled = true, minDistance = CARD_DISTANCE, effective = null }) {
  const location = useLocation();
  const [items, setItems] = useState([]);
  const itemsRef = useRef([]);
  const placeRef = useRef(place);
  placeRef.current = place;
  const key = season?.key || "season";
  const year = seasonYear(season);
  const strength = effective || season?.effective || "normal";

  useEffect(() => {
    itemsRef.current = [];
    setItems([]);
    if (!enabled || typeof document === "undefined") return undefined;
    const win = window;
    const doc = document;
    const rng = seasonRng({ season: key, year, route: location.pathname }, `cards:${kind}`);
    let cancelled = false;
    let nextId = 0;
    // Karten, an die die Deko nicht passt, werden erst wieder gefragt, wenn sie woanders liegen oder anders groß sind -
    // nach dem Scrollen misst die Seite sonst jedes Mal alle Karten neu ab.
    const failed = new WeakMap();
    const apply = (next) => {
      itemsRef.current = next;
      setItems(next);
    };
    const context = (anchor, neighbours) => ({ doc, win, probe: probeOf(doc), neighbours, seed: `${key}:${year}:${location.pathname}:${anchor.index}` });
    const refresh = () => {
      if (cancelled) return;
      const zones = measureQuietZones(doc, win);
      const neighbours = neighbourRects(doc, win);
      const current = itemsRef.current;
      let next = current.map((item) => {
        const again = remeasure(item, win);
        if (!again) return null;
        let geo = item.geo;
        // Wird die Karte breiter oder schmaler, passt die Form neu (oder gar nicht mehr).
        if (Math.abs(again.width - item.width) > 1 || Math.abs(again.height - item.height) > 1) {
          geo = placeRef.current({ element: item.element, rect: again.rect, index: item.index, key: item.anchorKey, card: item.card }, context(item, neighbours));
          if (!geo) return null;
        }
        const moved = again.x === item.x && again.y === item.y && geo === item.geo ? item : { ...item, x: again.x, y: again.y, width: again.width, height: again.height, geo };
        const yielding = yields(moved, zones);
        return yielding === Boolean(moved.yield) ? moved : { ...moved, yield: yielding };
      }).filter(Boolean);
      const cards = liftingCards(doc, win, { margin: VIEW_MARGIN });
      const visible = next.filter((item) => inView(item, win));
      const open = cardDecoCount(location.pathname, strength, doc.documentElement.clientWidth || win.innerWidth, cards.length) - visible.length;
      if (open > 0) {
        const taken = new Set(next.map((item) => item.element));
        const candidates = cards.filter((anchor) => !taken.has(anchor.element)).map((anchor) => {
          const signature = `${Math.round(anchor.page.left)}:${Math.round(anchor.page.top)}:${Math.round(anchor.rect.width)}:${Math.round(anchor.rect.height)}`;
          if (failed.get(anchor.element) === signature) return null;
          const geo = placeRef.current(anchor, context(anchor, neighbours));
          if (!geo) failed.set(anchor.element, signature);
          return geo ? decoItem(anchor, kind, geo, win) : null;
        }).filter(Boolean);
        const fresh = chooseDeco(freeSlots(candidates, { zones: zones.filter((zone) => !zone.overlay) }), open, rng, next, minDistance)
          .map((item) => ({ ...item, id: `${kind}-${nextId++}`, yield: yields(item, zones) }));
        if (fresh.length) next = [...next, ...fresh];
      }
      if (next.length !== current.length || next.some((item, index) => item !== current[index])) apply(next);
    };
    const timers = REFRESH_DELAYS.map((ms) => win.setTimeout(refresh, ms));
    let debounce = 0;
    const onLayout = () => {
      win.clearTimeout(debounce);
      debounce = win.setTimeout(refresh, 200);
    };
    win.addEventListener("resize", onLayout);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onLayout) : null;
    observer?.observe(doc.body);
    const stopWatching = watchOverlays(refresh);
    let settle = 0;
    const onScroll = () => {
      win.clearTimeout(settle);
      settle = win.setTimeout(refresh, 300);
    };
    win.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      timers.forEach((timer) => win.clearTimeout(timer));
      win.clearTimeout(debounce);
      win.clearTimeout(settle);
      win.removeEventListener("resize", onLayout);
      win.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      stopWatching();
    };
  }, [location.pathname, key, year, kind, enabled, minDistance, strength]);

  const update = useCallback((ids, patch) => {
    const wanted = new Set(ids);
    itemsRef.current = itemsRef.current.map((item) => (wanted.has(item.id) ? patch(item) : item));
    setItems(itemsRef.current);
  }, []);

  return { items, itemsRef, update };
}

/**
 * Die kleine Reaktion der Deko an einer Karte (#1091-#1094): hebt sich die Karte, reagiert ihre Deko einmal - danach ruht
 * diese Karte zehn Sekunden. `leaveMs` > 0: beim Loslassen dasselbe in klein, aber nur nach einem Anheben, das reagiert
 * hat und schon ausgeschwungen ist. `onLift(mine)` darf dabei rechnen (das Ei rollt weiter). Liefert je Deko
 * {kind: "lift" | "leave", n} - `n` zählt mit, damit eine neue Reaktion ihre Animation neu beginnt.
 */
export function useCardReaction(itemsRef, { durationMs, leaveMs = 0, enabled = true, onLift = null }) {
  const [reactions, setReactions] = useState({});
  const restRef = useRef(null);
  if (!restRef.current) restRef.current = createRest(REST_MS.small);
  const liftedRef = useRef(new Map());
  const counter = useRef(0);
  const timers = useRef(new Set());
  useEffect(() => () => {
    timers.current.forEach((id) => window.clearTimeout(id));
    timers.current.clear();
  }, []);
  const start = (mine, type, ms) => {
    counter.current += 1;
    const n = counter.current;
    const ids = mine.map((item) => item.id);
    setReactions((current) => ({ ...current, ...Object.fromEntries(ids.map((id) => [id, { kind: type, n }])) }));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setReactions((current) => {
        const next = { ...current };
        ids.forEach((id) => {
          if (next[id] && next[id].n === n) delete next[id];
        });
        return next;
      });
    }, ms + 60);
    timers.current.add(timer);
  };
  useCardSignal((detail) => {
    const mine = itemsRef.current.filter((item) => item.card === detail.key && !item.yield);
    if (detail.type === "lift") {
      if (!mine.length || !restRef.current.take(detail.key)) return;
      liftedRef.current.set(detail.key, Date.now());
      onLift?.(mine);
      start(mine, "lift", durationMs);
      return;
    }
    if (detail.type !== "leave") return;
    const liftedAt = liftedRef.current.get(detail.key);
    liftedRef.current.delete(detail.key);
    if (!leaveMs || !detail.lifted || liftedAt === undefined || Date.now() - liftedAt < durationMs || !mine.length) return;
    start(mine, "leave", leaveMs);
  }, enabled);
  return reactions;
}
