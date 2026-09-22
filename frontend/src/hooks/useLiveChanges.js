import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { changedKeys, countdownTickMs, formatCountdown, movedKeys } from "@/lib/liveChanges";

// Dynamik-Block (#224, #225, #226): sichtbar machen, was der Änderungsstrom still nachlädt.
// Alles endlich (nichts läuft dauerhaft) und mit „Bewegung reduzieren“ des Systems ohne Bewegung.

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

export function prefersReducedMotion() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(REDUCE_QUERY).matches;
}

export function useReducedMotion() {
  const [reduced, setReduced] = useState(prefersReducedMotion);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(REDUCE_QUERY);
    const update = () => setReduced(query.matches);
    query.addEventListener?.("change", update);
    return () => query.removeEventListener?.("change", update);
  }, []);
  return reduced;
}

/**
 * Welche Einträge sich seit dem letzten Stand geändert haben - für ein paar Sekunden.
 * Der erste Stand zählt nicht: Beim Laden ist nichts „neu“.
 */
export function useChangedKeys(items, keyOf, signatureOf, { holdMs = 6000 } = {}) {
  const previous = useRef(null);
  const [changed, setChanged] = useState(() => new Set());
  const timers = useRef(new Map());

  useEffect(() => {
    const before = previous.current;
    previous.current = items;
    if (!before || !items) return;
    const fresh = changedKeys(before, items, keyOf, signatureOf);
    if (!fresh.size) return;
    setChanged((current) => new Set([...current, ...fresh]));
    for (const key of fresh) {
      if (timers.current.has(key)) clearTimeout(timers.current.get(key));
      timers.current.set(key, setTimeout(() => {
        timers.current.delete(key);
        setChanged((current) => {
          if (!current.has(key)) return current;
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      }, holdMs));
    }
    // keyOf/signatureOf sind reine Funktionen; nur ein neuer Stand löst den Vergleich aus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, holdMs]);

  useEffect(() => () => {
    for (const timer of timers.current.values()) clearTimeout(timer);
  }, []);

  return changed;
}

/**
 * Zeilen bewegen sich sichtbar auf ihren neuen Platz (FLIP): vor dem neuen Stand die Lage
 * merken, danach von der alten Lage aus hinübergleiten. Mit „Bewegung reduzieren“ nichts.
 */
export function useFlipRows(items, keyOf, { durationMs = 450 } = {}) {
  const nodes = useRef(new Map());
  const lastRects = useRef(new Map());
  const previous = useRef(null);
  const reduced = useReducedMotion();

  const register = useMemo(() => (key) => (node) => {
    if (node) nodes.current.set(key, node);
    else nodes.current.delete(key);
  }, []);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = items;
    const moved = before && items ? movedKeys(before, items, keyOf) : new Map();
    if (!reduced && moved.size) {
      for (const key of moved.keys()) {
        const node = nodes.current.get(key);
        const last = lastRects.current.get(key);
        if (!node || !last || typeof node.animate !== "function") continue;
        const now = node.getBoundingClientRect();
        const dy = last.top - now.top;
        if (!dy) continue;
        node.animate([{ transform: `translateY(${dy}px)` }, { transform: "translateY(0)" }], { duration: durationMs, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" });
      }
    }
    lastRects.current = new Map();
    for (const [key, node] of nodes.current) lastRects.current.set(key, node.getBoundingClientRect());
    // keyOf ist rein; siehe useChangedKeys
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, reduced, durationMs]);

  return register;
}

/** „in 3 Tagen, 14 Stunden“ - tickt jede Minute, unter einer Stunde alle 15 Sekunden. */
export function useCountdown(targetMs) {
  const [text, setText] = useState(() => (targetMs ? formatCountdown(targetMs) : ""));
  useEffect(() => {
    if (!targetMs) {
      setText("");
      return undefined;
    }
    let timer = null;
    const tick = () => {
      setText(formatCountdown(targetMs));
      const next = countdownTickMs(targetMs);
      if (next) timer = setTimeout(tick, next);
    };
    tick();
    return () => { if (timer) clearTimeout(timer); };
  }, [targetMs]);
  return text;
}
