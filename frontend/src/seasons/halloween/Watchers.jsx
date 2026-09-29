import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { hashString, mulberry32 } from "../rng";
import { measureQuietZones } from "../quiet";
import { releaseMotion, requestMotion } from "../motion";
import { chooseSpot, edgeFree, freeSpots } from "./atmosphere";

// Beobachter (H15, #703): Augen im Dunkeln - ein Paar, in freier dunkler Fläche, langsam auf, ein- bis zweimal
// blinzeln, ein wenig zum Zeiger schauen, wieder weg; dazu selten ein Schatten am äußeren Rand, ein bis zwei
// Sekunden, ohne Ton, hinter allem Wichtigen. Beide fragen das Bewegungsbudget (`eyes`, `rare_edge`), halten
// Ruhezonen ein und lassen lange Pausen. Kein Jumpscare - das ist ein eigenes System (#680).

export const EYES_SHOW_MS = 8000;
export const EDGE_SHOW_MS = 1900;

/** Pupillen ein paar Pixel zum Zeiger - dieselbe Idee wie bei Laterne und Katze, ohne Umweg über index.jsx. */
export function lookOffset(pointer, center, reach = 2) {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  const distance = Math.hypot(dx, dy) || 1;
  const pull = Math.min(1, distance / 220);
  return { x: (dx / distance) * reach * pull, y: (dy / distance) * reach * pull };
}

/**
 * Augen im Dunkeln. `firstDelayMs` (von–bis) bis zum ersten Versuch, `pauseMs` (von–bis) danach; `probe` ersetzt
 * `elementFromPoint` (Tests).
 */
export function Eyes({ active, seed, salt, firstDelayMs = DEFAULT_EYES_DELAY, pauseMs = DEFAULT_EYES_PAUSE, showMs = EYES_SHOW_MS, probe }) {
  const location = useLocation();
  const [eyes, setEyes] = useState(null);
  const ref = useRef(null);
  const firstMin = firstDelayMs[0];
  const firstMax = firstDelayMs[1];
  const pauseMin = pauseMs[0];
  const pauseMax = pauseMs[1];
  useEffect(() => {
    setEyes(null);
    if (!active || typeof document === "undefined") return undefined;
    const win = window;
    const rng = mulberry32(hashString(`eyes:${seed}:${salt}:${location.pathname}`));
    let timer = 0;
    let hide = 0;
    let token = null;
    let cancelled = false;
    const schedule = (ms) => {
      win.clearTimeout(timer);
      timer = win.setTimeout(attempt, ms);
    };
    const attempt = () => {
      if (cancelled) return;
      token = requestMotion("eyes");
      if (!token) {
        schedule(30000);
        return;
      }
      const zones = measureQuietZones(document, win);
      const spot = chooseSpot(freeSpots(document, win, { zones, probe }), rng);
      if (!spot) {
        releaseMotion(token);
        token = null;
        schedule(45000 + rng() * 45000);
        return;
      }
      setEyes({ id: Date.now(), x: spot.x, y: spot.y, blinks: 1 + Math.floor(rng() * 2), edge: spot.edge });
      hide = win.setTimeout(() => {
        setEyes(null);
        releaseMotion(token);
        token = null;
        schedule(pauseMin + rng() * (pauseMax - pauseMin));
      }, showMs);
    };
    schedule(firstMin + rng() * (firstMax - firstMin));
    let frame = 0;
    const onMove = (event) => {
      if (frame || !ref.current) return;
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const offset = lookOffset({ x: event.clientX, y: event.clientY }, { x: box.left, y: box.top }, 2);
        ref.current.style.setProperty("--eye-x", `${offset.x.toFixed(2)}px`);
        ref.current.style.setProperty("--eye-y", `${offset.y.toFixed(2)}px`);
      });
    };
    win.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelled = true;
      win.clearTimeout(timer);
      win.clearTimeout(hide);
      win.removeEventListener("mousemove", onMove);
      if (frame) win.cancelAnimationFrame(frame);
      if (token) releaseMotion(token);
    };
  }, [active, seed, salt, location.pathname, firstMin, firstMax, pauseMin, pauseMax, showMs, probe]);
  if (!eyes || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} className="tls-eyes" style={{ left: `${eyes.x}px`, top: `${eyes.y}px`, "--blinks": eyes.blinks, "--eyes-seconds": `${showMs}ms` }} aria-hidden="true" data-testid="halloween-eyes" data-blinks={eyes.blinks}>
      <span className="tls-eyes__eye tls-eyes__eye--l"><span className="tls-eyes__pupil" /></span>
      <span className="tls-eyes__eye tls-eyes__eye--r"><span className="tls-eyes__pupil" /></span>
    </div>,
    document.body,
  );
}

export const DEFAULT_EYES_DELAY = [60000, 180000];
export const DEFAULT_EYES_PAUSE = [120000, 300000];
export const DEFAULT_EDGE_DELAY = [240000, 600000];
export const DEFAULT_EDGE_PAUSE = [300000, 720000];

/** Der seltene Schatten am äußeren Rand: nur wenn die Randspalte frei ist, ein bis zwei Sekunden, ohne Ton. */
export function RareEdge({ active, seed, salt, firstDelayMs = DEFAULT_EDGE_DELAY, pauseMs = DEFAULT_EDGE_PAUSE, showMs = EDGE_SHOW_MS, probe }) {
  const location = useLocation();
  const [event, setEvent] = useState(null);
  const firstMin = firstDelayMs[0];
  const firstMax = firstDelayMs[1];
  const pauseMin = pauseMs[0];
  const pauseMax = pauseMs[1];
  useEffect(() => {
    setEvent(null);
    if (!active || typeof document === "undefined") return undefined;
    const win = window;
    const rng = mulberry32(hashString(`edge:${seed}:${salt}:${location.pathname}`));
    let timer = 0;
    let hide = 0;
    let token = null;
    let cancelled = false;
    const schedule = (ms) => {
      win.clearTimeout(timer);
      timer = win.setTimeout(attempt, ms);
    };
    const attempt = () => {
      if (cancelled) return;
      token = requestMotion("rare_edge");
      if (!token) {
        schedule(60000);
        return;
      }
      const side = rng() < 0.5 ? "left" : "right";
      const zones = measureQuietZones(document, win);
      if (!edgeFree(document, win, side, { zones, probe })) {
        releaseMotion(token);
        token = null;
        schedule(120000 + rng() * 120000);
        return;
      }
      setEvent({ id: Date.now(), side, top: Math.round(18 + rng() * 50) });
      hide = win.setTimeout(() => {
        setEvent(null);
        releaseMotion(token);
        token = null;
        schedule(pauseMin + rng() * (pauseMax - pauseMin));
      }, showMs);
    };
    schedule(firstMin + rng() * (firstMax - firstMin));
    return () => {
      cancelled = true;
      win.clearTimeout(timer);
      win.clearTimeout(hide);
      if (token) releaseMotion(token);
    };
  }, [active, seed, salt, location.pathname, firstMin, firstMax, pauseMin, pauseMax, showMs, probe]);
  if (!event || typeof document === "undefined") return null;
  return createPortal(
    <div className={`tls-edge tls-edge--${event.side}`} style={{ top: `${event.top}vh`, "--edge-seconds": `${showMs}ms` }} aria-hidden="true" data-testid="halloween-edge" data-side={event.side}>
      <span className="tls-edge__shade" />
    </div>,
    document.body,
  );
}
