import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { EASE_MOVE, MOTION, motionAllowed } from "@/lib/motion";
import { compareBoards, rowChips } from "@/lib/tvFastLap";
import { flipDeltas, rankMoves } from "@/lib/flip";

// Bewegung in der Fast-Lap-Tabelle (#1585), in derselben Haltung wie Turnierbaum (#1561) und TV (#1564):
// - Kommt eine neue Zeit, gleitet die Zeile an ihren neuen Platz und die anderen rücken weich nach (FLIP über
//   transform, Kurve EASE_MOVE wie der Flug im Baum).
// - Die neue Zeit läuft kurz von der alten zur neuen (LapTime `from`), die Platzziffer setzt mit kleinem Überschwingen
//   auf, die Zeile leuchtet ruhig auf; an der Zeile steht kurz „−0.412 s · persönliche Bestzeit“.
// - Eine neue Bestzeit (Platz 1) bekommt einen ruhigen Glanz und oben ein Band „Neue Bestzeit!“.
// Nur transform und opacity. „Bewegung reduzieren“: keine Wege, kein Zählen - Hinweis und Band stehen einfach da.
// Unterbrechung: kommt während einer Bewegung die nächste Zeit, beginnt die neue Bewegung von der aktuellen Stelle
// (die laufende wird abgebrochen, gemessen wird die Lage im Layout, nicht die gezeichnete).

export const CHIP_MS = 8000;
export const BEST_MS = 4200;
const FLIP_MS = Math.round(MOTION.slow * 1.6);

function layoutTops(container) {
  const out = new Map();
  if (!container) return out;
  container.querySelectorAll("[data-flip-key]").forEach((node) => out.set(node.getAttribute("data-flip-key"), node.offsetTop));
  return out;
}

function rowNode(container, key) {
  return [...container.querySelectorAll("[data-flip-key]")].find((node) => node.getAttribute("data-flip-key") === key) || null;
}

const EMPTY = { chips: new Map(), fresh: new Set(), fromMs: new Map(), best: null, bestKey: null };

export function useLapBoardMotion(board, containerRef) {
  const previous = useRef(null);
  const tops = useRef(new Map());
  const running = useRef(new Map());
  const [marks, setMarks] = useState(EMPTY);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!board) return;
    const before = previous.current;
    previous.current = board;
    const now = layoutTops(container);
    const sameTrack = before && (before.track?.id || "") === (board.track?.id || "");
    const oldTops = tops.current;
    tops.current = now;
    if (!sameTrack || !container) {
      setMarks(EMPTY);
      return;
    }
    const change = compareBoards(before, board);
    const chips = rowChips(change);
    if (!chips.size) return;
    const moving = motionAllowed();
    if (moving) {
      const easing = `cubic-bezier(${EASE_MOVE.join(", ")})`;
      flipDeltas(oldTops, now).forEach((delta, key) => {
        const node = rowNode(container, key);
        if (!node || typeof node.animate !== "function") return;
        running.current.get(key)?.cancel();
        running.current.set(key, node.animate([{ transform: `translateY(${delta}px)` }, { transform: "translateY(0)" }], { duration: FLIP_MS, easing }));
      });
      rankMoves(before.entries, board.entries).forEach((direction, key) => {
        const digit = rowNode(container, key)?.querySelector("[data-rank-digit]");
        if (!digit || typeof digit.animate !== "function") return;
        // Kleines Überschwingen beim Aufsetzen - erst, wenn die Zeile fast angekommen ist.
        digit.animate(direction === "up"
          ? [{ transform: "scale(0.82)", opacity: 0.4 }, { transform: "scale(1.12)", opacity: 1, offset: 0.6 }, { transform: "scale(1)", opacity: 1 }]
          : [{ opacity: 0.4 }, { opacity: 1 }],
        { duration: MOTION.slow, delay: FLIP_MS * 0.55, easing: `cubic-bezier(${MOTION.ease.join(", ")})`, fill: "backwards" });
      });
    }
    const until = Date.now() + CHIP_MS;
    setMarks((current) => {
      const nextChips = new Map([...current.chips].filter(([, chip]) => chip.until > Date.now()));
      chips.forEach((chip, key) => nextChips.set(key, { ...chip, until }));
      const fromMs = new Map();
      if (moving) change.improved.forEach((row) => fromMs.set(row.userId, Number(row.old.time_ms)));
      return {
        chips: nextChips,
        fresh: new Set(chips.keys()),
        fromMs,
        best: change.best || current.best,
        bestKey: change.best ? `${change.best.userId}:${change.best.entry.time_ms}` : current.bestKey,
      };
    });
  }, [board, containerRef]);

  // Abgelaufene Hinweise und das Band wieder weg.
  useEffect(() => {
    if (!marks.chips.size && !marks.best) return undefined;
    const ends = [...marks.chips.values()].map((chip) => chip.until);
    const next = Math.min(...ends, marks.best ? Date.now() + BEST_MS : Infinity);
    const timer = window.setTimeout(() => {
      setMarks((current) => ({
        ...current,
        chips: new Map([...current.chips].filter(([, chip]) => chip.until > Date.now())),
        best: null,
        fresh: new Set(),
      }));
    }, Math.max(50, next - Date.now()));
    return () => window.clearTimeout(timer);
  }, [marks]);

  useEffect(() => () => running.current.forEach((animation) => animation.cancel()), []);
  return marks;
}
