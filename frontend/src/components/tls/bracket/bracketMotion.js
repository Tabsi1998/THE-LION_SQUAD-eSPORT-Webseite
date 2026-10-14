import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { diffBracket, slotDraw } from "@/lib/bracketGraph";
import { finderFor } from "@/lib/slotSource";
import { EASE_MOVE, MOTION, motionAllowed } from "@/lib/motion";

// Bewegungen im Turnierbaum (#1561), ausgelöst vom Vergleich alter/neuer Stand beim Live-Neuladen (wie useChangedKeys):
//   Ergebnis      Platzziffern poppen nacheinander mit kleinem Überschwingen, Punkte zählen hoch
//   Weiterkommen  der Name hebt sich kurz an, fährt die gezeichnete Linie entlang (bei gemischten Gruppen über die
//                 Sammelschiene, #1548) und setzt mit leichtem Nachfedern auf; die Linie zeichnet sich hinter ihm her,
//                 die Zielzeile leuchtet beim Ankommen weich auf
//   Zusammenlegen die Namen fließen aus dem alten Lauf in die Sammelkarte, die alte Karte verblasst
//   Auslosung     die Namen kommen nacheinander in die Läufe (data-motion="draw")
//   kampflos      der Platz blinkt einmal; entfällt: die Karte verblasst
// Gestaffelt (60 ms), nie alles auf einmal. Jede Bewegung läuft genau einmal (Schlüssel aus diffBracket). Kommt ein
// neuer Stand, während noch etwas fliegt, springt alles sofort ans Ende. Der erste Stand, ein Nachladen nach einer
// Neuverbindung (`quiet`), ein verdeckter Tab, ein Riesen-Sprung und „Bewegung reduzieren“ zeigen sofort das Ende.

export const GLIDE_MS = MOTION.slow + MOTION.mid;
const STAGGER_MS = 60;
const GLIDE_AFTER_POP_MS = MOTION.slow;
const HOLD_MS = GLIDE_AFTER_POP_MS + GLIDE_MS + MOTION.slow * 3;
const MAX_EVENTS = 48;
const EASE = `cubic-bezier(${EASE_MOVE.join(", ")})`;

const EMPTY = Object.freeze({ stamp: 0, pop: new Set(), blink: new Set(), fade: new Set(), rows: new Map(), fresh: new Map(), drawStep: STAGGER_MS });

export const BracketMotionContext = createContext({ state: EMPTY, played: new Set() });

export function useBracketMotionState() {
  return useContext(BracketMotionContext);
}

/** Baut aus den Ereignissen, was jede Karte, Zeile und Linie zeigt. */
export function motionState(events, stamp = 1) {
  const state = { stamp, pop: new Set(), blink: new Set(), fade: new Set(), rows: new Map(), fresh: new Map(), drawStep: STAGGER_MS };
  const popped = new Set(events.filter((event) => event.type === "result").map((event) => event.matchId));
  let glide = 0;
  const draws = events.filter((event) => event.type === "draw").length;
  // Viele Namen (40 Teilnehmer): 40–80 ms Versatz, die Auslosung bleibt kurz.
  state.drawStep = draws > 1 ? Math.max(40, Math.min(80, Math.round(1600 / draws))) : STAGGER_MS;
  for (const event of events) {
    if (event.type === "result") state.pop.add(event.matchId);
    else if (event.type === "walkover") state.blink.add(event.matchId);
    else if (event.type === "fate") state.fade.add(event.matchId);
    else if (event.type === "draw" && !event.from) state.rows.set(`${event.matchId}:${event.registrationId}`, { type: "draw", key: event.key, index: event.index });
    else if (event.type === "advance" || event.type === "merge" || event.type === "draw") {
      const delay = (popped.has(event.from.matchId) ? GLIDE_AFTER_POP_MS : 0) + glide * STAGGER_MS;
      glide += 1;
      state.rows.set(`${event.matchId}:${event.registrationId}`, { type: event.type, key: event.key, from: event.from, delay, rail: event.rail || null });
      // Die Linie zeichnet sich hinter dem Namen her: gleicher Start, gleiche Dauer, gleiche Kurve.
      state.fresh.set(`${event.from.matchId}>${event.matchId}`, { delay, duration: GLIDE_MS });
    }
  }
  return state;
}

// Laufende Flüge: kommt ein neuer Stand, springen sie ans Ende (nichts hängt, nichts doppelt).
const activeFlights = new Set();

export function finishFlights() {
  for (const flight of [...activeFlights]) flight.finish();
}

/**
 * Auslosung einer gemischten Runde (#1548): die Bewegung „draw“ (wie in der App) bekommt hier die echte Herkunft
 * dazu - so fährt der Name aus seinem Quellspiel über die Sammelschiene an seinen gezogenen Platz.
 */
export function withDrawOrigins(events, matches) {
  const byId = new Map((matches || []).map((match) => [match.id, match]));
  const find = finderFor(matches || []);
  return events.map((event) => {
    if (event.type !== "draw") return event;
    const match = byId.get(event.matchId);
    const slot = (match?.slots || []).find((row) => row.registration_id === event.registrationId);
    const origin = slot?.source_result?.from_match_key;
    if (!slotDraw(slot) || !origin) return event;
    const from = find(match)(origin);
    return from ? { ...event, from: { matchId: from.id, registrationId: event.registrationId }, rail: slotDraw(slot).group || null } : event;
  });
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
    finishFlights();
    const events = withDrawOrigins(diffBracket(before, matches), matches).filter((event) => !seen.current.has(event.key));
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

  useEffect(() => () => finishFlights(), []);

  return { state, played: played.current };
}

function makeGhost(toEl, a, b) {
  const ghost = toEl.cloneNode(true);
  if (typeof ghost.animate !== "function") return null;
  ghost.setAttribute("data-bracket-flyer", "1");
  ghost.setAttribute("aria-hidden", "true");
  for (const node of [ghost, ...ghost.querySelectorAll("[data-testid],[data-row],[data-slot-anchor],[data-motion]")]) {
    node.removeAttribute("data-testid");
    node.removeAttribute("data-row");
    node.removeAttribute("data-slot-anchor");
    node.removeAttribute("data-motion");
  }
  Object.assign(ghost.style, {
    position: "fixed", left: `${a.left}px`, top: `${a.top + (a.height - b.height) / 2}px`, width: `${b.width}px`, height: `${b.height}px`,
    margin: "0", zIndex: "60", pointerEvents: "none", opacity: "1", transformOrigin: "0 50%",
  });
  ghost.classList.add("tls-bracket-flyer");
  return ghost;
}

/** Punkte eines gezeichneten Linienzugs (M/L, wie lib/bracketLines.toPath) in Bildschirm-Koordinaten. */
function pathPoints(pathEl) {
  const svg = pathEl?.ownerSVGElement;
  if (!svg) return [];
  const box = svg.getBoundingClientRect();
  return (pathEl.getAttribute("d") || "").match(/[ML][^ML]+/g)?.map((part) => {
    const [x, y] = part.slice(1).trim().split(/[\s,]+/).map(Number);
    return { x: box.left + x, y: box.top + y };
  }).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)) || [];
}

/**
 * Lässt einen Namen von `fromEl` nach `toEl` fahren - entlang der gezeichneten Linie `pathEl` (über Gassen und
 * Sammelschiene), sonst entlang des einfachen Ellbogens. Hebt sich beim Start leicht an (Scale 1,03, Schatten),
 * setzt mit leichtem Nachfedern auf, eine Kurve über den ganzen Weg. Das Ziel bleibt so lange unsichtbar und leuchtet
 * beim Ankommen weich auf. Ohne WAAPI springt alles sofort ans Ende.
 */
export function flyName(fromEl, toEl, { delay = 0, duration = GLIDE_MS, pathEl = null } = {}) {
  if (!fromEl || !toEl || typeof document === "undefined") return;
  const a = fromEl.getBoundingClientRect();
  const b = toEl.getBoundingClientRect();
  const ghost = makeGhost(toEl, a, b);
  if (!ghost) return;
  document.body.appendChild(ghost);
  toEl.style.opacity = "0";
  const anchorY = a.top + a.height / 2;
  const start = { x: a.left, y: anchorY };
  const end = { x: b.left, y: b.top + b.height / 2 };
  let route = pathPoints(pathEl);
  if (route.length < 2) {
    const mid = start.x + (end.x - start.x) / 2;
    route = [{ x: mid, y: start.y }, { x: mid, y: end.y }];
  }
  const points = [start, ...route, end];
  const lengths = points.slice(1).map((point, index) => Math.abs(point.x - points[index].x) + Math.abs(point.y - points[index].y));
  const total = lengths.reduce((sum, value) => sum + value, 0) || 1;
  let walked = 0;
  const lift = (offset) => (offset < 0.08 ? 1 + 0.03 * (offset / 0.08) : 1.03);
  const frames = points.map((point, index) => {
    if (index) walked += lengths[index - 1];
    const offset = Math.min(1, walked / total);
    return { transform: `translate(${point.x - start.x}px, ${point.y - start.y}px) scale(${index === points.length - 1 ? 0.985 : lift(offset)})`, offset: index === points.length - 1 ? 0.94 : offset * 0.94 };
  });
  // Nachfedern: kurz unter 1, dann ruhig auf 1.
  frames.push({ transform: `translate(${end.x - start.x}px, ${end.y - start.y}px) scale(1)`, offset: 1 });
  let done = false;
  let animation = null;
  const flight = {
    finish() {
      if (done) return;
      done = true;
      activeFlights.delete(flight);
      try { animation?.cancel?.(); } catch { /* schon vorbei */ }
      ghost.remove();
      toEl.style.opacity = "";
      // Weich aufleuchten, wo der Name ankommt.
      toEl.setAttribute("data-landed", "1");
      setTimeout(() => toEl.removeAttribute("data-landed"), MOTION.slow * 2);
    },
  };
  activeFlights.add(flight);
  try {
    animation = ghost.animate(frames, { duration, delay, easing: EASE, fill: "both" });
    Promise.resolve(animation?.finished).then(() => flight.finish(), () => flight.finish());
  } catch {
    flight.finish();
  }
}

/**
 * Eine Zeile, in die gerade jemand kommt (Weiterkommen, Zusammenlegen): startet einmal den Flug aus dem Quellspiel -
 * entlang der Linie, die in genau diesen Platz führt. `ref` zeigt auf die Zeile; gesucht wird im selben Baum.
 */
export function useRowFlight(ref, rowMotion, played, slotNo = null) {
  useLayoutEffect(() => {
    if (!rowMotion || !rowMotion.from || (rowMotion.type !== "advance" && rowMotion.type !== "merge" && rowMotion.type !== "draw")) return;
    if (played.has(rowMotion.key)) return;
    const target = ref.current;
    const root = target?.closest("[data-bracket-root]");
    if (!root) return;
    played.add(rowMotion.key);
    const { matchId, registrationId } = rowMotion.from;
    const source = (registrationId && root.querySelector(`[data-row="${matchId}:${registrationId}"]`))
      || root.querySelector(`[data-node="${matchId}"]`);
    const toMatch = target.closest("[data-node]")?.getAttribute("data-node");
    const pathEl = rowMotion.type !== "merge" && toMatch
      ? (root.querySelector(`path[data-from="${matchId}"][data-to="${toMatch}"][data-to-slot="${slotNo}"]`)
        || root.querySelector(`path[data-from="${matchId}"][data-to="${toMatch}"]`))
      : null;
    flyName(source, target, { delay: rowMotion.delay, pathEl });
    // Kein Abbruch beim Aufräumen: der Flug landet von selbst (auch im StrictMode, der Effekte doppelt aufruft).
  }, [ref, rowMotion, played, slotNo]);
}
