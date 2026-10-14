import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { diffBracket } from "@/lib/bracketGraph";
import { EASE_MOVE, MOTION, motionAllowed } from "@/lib/motion";

// Bewegungen im Turnierbaum (#1561), ausgelöst vom Vergleich alter/neuer Stand beim Live-Neuladen (wie useChangedKeys):
//   Ergebnis      Platzziffern poppen nacheinander (CSS, data-motion="pop")
//   Weiterkommen  der Name gleitet entlang der Linie ins nächste Spiel (WAAPI, eine Kurve über den ganzen Ellbogen),
//                 danach zieht die Linie nach (data-fresh)
//   Zusammenlegen die Namen fließen aus dem alten Lauf in die Sammelkarte, die alte Karte verblasst
//   Auslosung     die Namen kommen nacheinander in die Läufe (CSS, data-motion="draw")
//   kampflos      der Platz blinkt einmal (data-motion="blink"); entfällt: die Karte verblasst (data-motion="fade")
// Jede Bewegung läuft genau einmal (Schlüssel aus diffBracket). Der erste Stand, ein Nachladen nach einer Neuverbindung
// (`quiet`), ein verdeckter Tab, ein Riesen-Sprung (mehr als MAX_EVENTS) und „Bewegung reduzieren“ springen sofort
// in den Endzustand.

export const GLIDE_MS = MOTION.slow + MOTION.mid;
const POP_STEP_MS = 60;
const GLIDE_AFTER_POP_MS = MOTION.slow;
const HOLD_MS = GLIDE_AFTER_POP_MS + GLIDE_MS + MOTION.slow * 2;
const MAX_EVENTS = 48;
const EASE = `cubic-bezier(${EASE_MOVE.join(", ")})`;

const EMPTY = Object.freeze({ stamp: 0, pop: new Set(), blink: new Set(), fade: new Set(), rows: new Map(), fresh: new Map(), drawStep: 60 });

export const BracketMotionContext = createContext({ state: EMPTY, played: new Set() });

export function useBracketMotionState() {
  return useContext(BracketMotionContext);
}

/** Baut aus den Ereignissen, was jede Karte, Zeile und Linie zeigt. */
export function motionState(events, stamp = 1) {
  const state = { stamp, pop: new Set(), blink: new Set(), fade: new Set(), rows: new Map(), fresh: new Map(), drawStep: 60 };
  const popped = new Set(events.filter((event) => event.type === "result").map((event) => event.matchId));
  let glide = 0;
  const draws = events.filter((event) => event.type === "draw").length;
  // Viele Namen (40 Teilnehmer): die Auslosung bleibt unter gut einer Sekunde.
  state.drawStep = draws > 1 ? Math.max(20, Math.min(60, Math.round(1200 / draws))) : 60;
  for (const event of events) {
    if (event.type === "result") state.pop.add(event.matchId);
    else if (event.type === "walkover") state.blink.add(event.matchId);
    else if (event.type === "fate") state.fade.add(event.matchId);
    else if (event.type === "draw") state.rows.set(`${event.matchId}:${event.registrationId}`, { type: "draw", key: event.key, index: event.index });
    else if (event.type === "advance" || event.type === "merge") {
      const delay = (popped.has(event.from.matchId) ? GLIDE_AFTER_POP_MS : 0) + glide * POP_STEP_MS;
      glide += 1;
      state.rows.set(`${event.matchId}:${event.registrationId}`, { type: event.type, key: event.key, from: event.from, delay });
      state.fresh.set(`${event.from.matchId}>${event.matchId}`, delay + Math.round(GLIDE_MS * 0.6));
    }
  }
  return state;
}

/** Vergleicht jeden neuen Stand mit dem vorigen und hält die Bewegungen für ein paar Sekunden bereit. */
export function useBracketMotion(matches, { quiet = false } = {}) {
  const previous = useRef(null);
  const seen = useRef(new Set());
  const played = useRef(new Set());
  const stamp = useRef(0);
  const [state, setState] = useState(EMPTY);

  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = matches;
    if (!before || !matches || before === matches) return undefined;
    const events = diffBracket(before, matches).filter((event) => !seen.current.has(event.key));
    for (const event of events) seen.current.add(event.key);
    const hidden = typeof document !== "undefined" && document.hidden;
    if (!events.length || quiet || hidden || events.length > MAX_EVENTS || !motionAllowed()) {
      setState((current) => (current === EMPTY ? current : EMPTY));
      return undefined;
    }
    stamp.current += 1;
    setState(motionState(events, stamp.current));
    return undefined;
  }, [matches, quiet]);

  useEffect(() => {
    if (state === EMPTY) return undefined;
    const timer = setTimeout(() => setState(EMPTY), HOLD_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return { state, played: played.current };
}

/**
 * Lässt einen Namen von `fromEl` nach `toEl` gleiten - entlang des Ellbogens der Linie (waagrecht, senkrecht,
 * waagrecht), mit einer einzigen Kurve über den ganzen Weg. Ein Abbild fliegt über allem (fixed), das Ziel bleibt so
 * lange unsichtbar und erscheint, wenn das Abbild landet. Ohne WAAPI springt alles sofort ans Ende.
 */
export function flyName(fromEl, toEl, { delay = 0, duration = GLIDE_MS } = {}) {
  if (!fromEl || !toEl || typeof document === "undefined") return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const ghost = toEl.cloneNode(true);
  if (typeof ghost.animate !== "function") return;
  ghost.setAttribute("data-bracket-flyer", "1");
  ghost.setAttribute("aria-hidden", "true");
  ghost.removeAttribute("data-testid");
  ghost.removeAttribute("data-row");
  ghost.querySelectorAll("[data-testid],[data-row],[data-slot-anchor]").forEach((node) => {
    node.removeAttribute("data-testid");
    node.removeAttribute("data-row");
    node.removeAttribute("data-slot-anchor");
  });
  const startTop = a.top + (a.height - b.height) / 2;
  Object.assign(ghost.style, {
    position: "fixed", left: `${a.left}px`, top: `${startTop}px`, width: `${b.width}px`, height: `${b.height}px`,
    margin: "0", zIndex: "60", pointerEvents: "none", opacity: "1",
  });
  ghost.classList.add("tls-bracket-flyer");
  document.body.appendChild(ghost);
  toEl.style.opacity = "0";
  const dx = b.left - a.left;
  const dy = b.top - startTop;
  const mid = dx / 2;
  let finished = false;
  const land = () => {
    if (finished) return;
    finished = true;
    ghost.remove();
    toEl.style.opacity = "";
  };
  try {
    const animation = ghost.animate([
      { transform: "translate(0px, 0px)", offset: 0 },
      { transform: `translate(${mid}px, 0px)`, offset: 0.4 },
      { transform: `translate(${mid}px, ${dy}px)`, offset: 0.6 },
      { transform: `translate(${dx}px, ${dy}px)`, offset: 1 },
    ], { duration, delay, easing: EASE, fill: "both" });
    Promise.resolve(animation?.finished).then(land, land);
  } catch {
    land();
  }
}

/**
 * Eine Zeile, in die gerade jemand kommt (Weiterkommen, Zusammenlegen): startet einmal den Flug aus dem Quellspiel.
 * `ref` zeigt auf die Zeile; gesucht wird die Quelle im selben Baum (`[data-bracket-root]`).
 */
export function useRowFlight(ref, rowMotion, played) {
  useLayoutEffect(() => {
    if (!rowMotion || (rowMotion.type !== "advance" && rowMotion.type !== "merge")) return;
    if (played.has(rowMotion.key)) return;
    const target = ref.current;
    const root = target?.closest("[data-bracket-root]");
    if (!root) return;
    played.add(rowMotion.key);
    const { matchId, registrationId } = rowMotion.from;
    const source = (registrationId && root.querySelector(`[data-row="${matchId}:${registrationId}"]`))
      || root.querySelector(`[data-node="${matchId}"]`);
    flyName(source, target, { delay: rowMotion.delay });
    // Kein Abbruch beim Aufräumen: der Flug landet von selbst (auch im StrictMode, der Effekte doppelt aufruft).
  }, [ref, rowMotion, played]);
}
