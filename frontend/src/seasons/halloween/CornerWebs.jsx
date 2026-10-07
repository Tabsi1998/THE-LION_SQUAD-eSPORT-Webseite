import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { hashString, mulberry32 } from "../rng";
import { measureQuietZones, overlayZones, rectInQuiet, watchOverlays } from "../quiet";
import { releaseMotion, requestMotion } from "../motion";
import { Spider } from "./art";
import { buildPlan, staticLines } from "./web";
import { chooseWebCorners, hubOf, measureWebCorners } from "./webCorners";
import { CARD_SELECTOR, LIFTING_CLASS, REST_MS, cardKey, createRest, endReaction, startReaction } from "../cardLift";
import { useCardSignal } from "../useCardSignal";
import { TEAR, buildDelays, lineLength, tearPlan } from "./webTear";

// Kleine Netze an echten Ecken (H12, #700): still und fein in den oberen Innenecken von Karten und der Fußzeile,
// je Fenster höchstens `count`, beim Scrollen kommen weitere Ecken dazu (nie mehr als `count` je Fensterhöhe).
// Eine winzige Spinne läuft selten über ihr Netz (Bewegungsbudget) und zieht sich zurück, wenn der Zeiger näher
// kommt. Unter geöffneten Dialogen und Menüs weicht ein Netz aus. Ohne Bewegung (dezent, Reduced Motion) bleiben
// die Netze, nur die Spinne bleibt fort.

const REFRESH_DELAYS = [400, 1500, 3500];
export const WALK_SECONDS = 6;
export const RETREAT_RADIUS = 90;
export const RETREAT_COOLDOWN_MS = 30000;
export const DEFAULT_WALK_DELAY_MS = [40000, 120000];

/** Liegt ein Netz unter einem geöffneten Dialog oder Menü? */
export function webYields(web, zones) {
  const overlays = overlayZones(zones);
  if (!overlays.length) return false;
  const left = web.side === "tl" ? web.x : web.x - web.spec.width;
  return rectInQuiet({ left, top: web.y, right: left + web.spec.width, bottom: web.y + web.spec.height }, overlays, { fixed: false, overlayOnly: true });
}

function inView(web, win) {
  const top = win.scrollY || 0;
  return web.y >= top - 60 && web.y <= top + win.innerHeight + 60;
}

function useLines(spec, side) {
  return useMemo(() => staticLines(buildPlan(spec.seed), spec.radius, side === "tr"), [spec.seed, spec.radius, side]);
}

function Thread({ line, className, style }) {
  return <line className={className} style={style} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.kind === "spiral" ? "rgba(170, 225, 240, 0.42)" : "rgba(170, 225, 240, 0.6)"} strokeWidth={line.kind === "spiral" ? 0.55 : 0.8} strokeLinecap="round" />;
}

/**
 * Ein Netz als SVG: dieselben Fäden wie das statische Netz der Fensterecke, nur kleiner und blasser. `build`: Neubau
 * nach dem Reißen (#1089) - Faden für Faden in der Reihenfolge, in der die Spinne spinnt.
 */
function Net({ spec, side, build = false }) {
  const lines = useLines(spec, side);
  const delays = useMemo(() => (build ? buildDelays(lines.length) : []), [build, lines.length]);
  return (
    <svg className={`tls-cweb__net${build ? " tls-cweb__net--build" : ""}`} width={spec.width} height={spec.height} viewBox={`0 0 ${spec.width} ${spec.height}`} aria-hidden="true">
      {lines.map((line, index) => (
        <Thread key={index} line={line} style={build ? { "--len": `${lineLength(line)}px`, "--delay": `${delays[index]}ms` } : undefined} />
      ))}
    </svg>
  );
}

/** Das reißende Netz (#1089): Anker und Rahmen reißen nacheinander, ein Fetzen weht davon, der Rest löst sich auf. */
function TornNet({ spec, side, plan }) {
  const lines = useLines(spec, side);
  const hub = hubOf(spec, side);
  const of = (role) => plan.lines.filter((entry) => entry.role === role && lines[entry.index]);
  return (
    <svg className="tls-cweb__net tls-cweb__net--torn" width={spec.width} height={spec.height} viewBox={`0 0 ${spec.width} ${spec.height}`} aria-hidden="true" data-testid="halloween-corner-web-torn">
      <g className="tls-cweb__rest">
        {of("fade").map((entry) => <Thread key={entry.index} line={lines[entry.index]} />)}
      </g>
      {of("snap").map((entry) => (
        <Thread key={entry.index} line={lines[entry.index]} className="tls-cweb__snap" style={{ "--len": `${entry.length}px`, "--delay": `${entry.delay}ms` }} />
      ))}
      <g className="tls-cweb__scrap" style={{ transformOrigin: `${hub.x.toFixed(1)}px ${hub.y.toFixed(1)}px`, "--dx": `${plan.scrap.dx}px`, "--dy": `${plan.scrap.dy}px`, "--turn": `${plan.scrap.turn}deg` }}>
        {of("scrap").map((entry) => <Thread key={entry.index} line={lines[entry.index]} />)}
      </g>
    </svg>
  );
}

/** Der Kartenschlüssel eines Netzes - nur an Karten, die sich heben (#1087); Fußzeile und Rahmen nicht. */
export function webCard(web) {
  const element = web && web.element;
  if (!element || typeof element.matches !== "function" || !element.matches(CARD_SELECTOR) || !element.classList.contains(LIFTING_CLASS)) return null;
  return cardKey(element);
}

/**
 * `count` Netze je Fensterhöhe. `moving` schaltet die Spinne; `walkDelayMs` (von–bis) ist die Pause zwischen zwei
 * Läufen - in Tests kürzer.
 */
export function CornerWebs({ count, seed, salt, moving = true, walkDelayMs = DEFAULT_WALK_DELAY_MS }) {
  const location = useLocation();
  const [webs, setWebs] = useState([]);
  const websRef = useRef([]);
  // Zahlen statt der Liste als Abhängigkeit: eine je Render neue Liste ließe den Effekt endlos neu starten.
  const walkMin = walkDelayMs[0];
  const walkMax = walkDelayMs[1];

  useEffect(() => {
    websRef.current = [];
    setWebs([]);
    if (!count || typeof document === "undefined") return undefined;
    const win = window;
    const rng = mulberry32(hashString(`cwebs:${seed}:${salt}:${location.pathname}`));
    let cancelled = false;
    let nextId = 0;
    const apply = (next) => {
      websRef.current = next;
      setWebs(next);
    };
    const refresh = () => {
      if (cancelled) return;
      const zones = measureQuietZones(document, win);
      const current = websRef.current;
      let next = current.map((web) => {
        const point = web.measure();
        if (!point) return null;
        const moved = point.x === web.x && point.y === web.y ? web : { ...web, x: point.x, y: point.y };
        const yielding = webYields(moved, zones);
        return yielding === Boolean(moved.yield) ? moved : { ...moved, yield: yielding };
      }).filter(Boolean);
      const visible = next.filter((web) => inView(web, win));
      const open = count - visible.length;
      if (open > 0) {
        const found = measureWebCorners(document, win, { zones, taken: new Set(next.map((web) => web.key)), seed: `${seed}:${salt}` });
        if (found.length) {
          const fresh = chooseWebCorners(found, open, rng, next).map((corner) => ({ ...corner, id: nextId++, yield: false, spider: null, nextWalkAt: performance.now() + walkMin + rng() * (walkMax - walkMin), retreatedAt: -Infinity }));
          next = [...next, ...fresh];
        }
      }
      if (next.length !== current.length || next.some((web, index) => web !== current[index])) apply(next);
    };
    const timers = REFRESH_DELAYS.map((ms) => win.setTimeout(refresh, ms));
    let debounce = 0;
    const onLayout = () => {
      win.clearTimeout(debounce);
      debounce = win.setTimeout(refresh, 200);
    };
    win.addEventListener("resize", onLayout);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onLayout) : null;
    observer?.observe(document.body);
    const stopWatching = watchOverlays(refresh);
    let scrollSettle = 0;
    const onScroll = () => {
      win.clearTimeout(scrollSettle);
      scrollSettle = win.setTimeout(refresh, 300);
    };
    win.addEventListener("scroll", onScroll, { passive: true });

    // Die winzige Spinne: selten, eine nach der anderen (Budget `web_spider`), nur mit Bewegung und nur im Fenster.
    const tokens = new Map();
    let ticker = 0;
    let pointer = null;
    let frame = 0;
    const tick = () => {
      if (cancelled || !moving || document.hidden) return;
      const now = performance.now();
      let changed = false;
      const next = websRef.current.map((web) => {
        if (web.spider) {
          if (now >= web.spider.until) {
            releaseMotion(tokens.get(web.id));
            tokens.delete(web.id);
            changed = true;
            return { ...web, spider: null, nextWalkAt: now + walkMin + rng() * (walkMax - walkMin) };
          }
          return web;
        }
        if (web.yield || web.tear || now < web.nextWalkAt || !inView(web, win)) return web;
        const token = requestMotion("web_spider");
        if (!token) return { ...web, nextWalkAt: now + 15000 };
        tokens.set(web.id, token);
        changed = true;
        return { ...web, spider: { phase: "walk", until: now + WALK_SECONDS * 1000 } };
      });
      if (changed) apply(next);
    };
    if (moving) ticker = win.setInterval(tick, 1000);
    const onMove = (event) => {
      pointer = { x: event.clientX + (win.scrollX || 0), y: event.clientY + (win.scrollY || 0) };
      if (frame) return;
      frame = win.requestAnimationFrame(() => {
        frame = 0;
        const now = performance.now();
        let changed = false;
        const next = websRef.current.map((web) => {
          if (!web.spider || web.spider.phase !== "walk" || now - web.retreatedAt < RETREAT_COOLDOWN_MS) return web;
          const hub = hubOf(web.spec, web.side);
          const left = web.side === "tl" ? web.x : web.x - web.spec.width;
          if (Math.hypot(pointer.x - (left + hub.x), pointer.y - (web.y + hub.y)) > RETREAT_RADIUS) return web;
          changed = true;
          return { ...web, spider: { phase: "retreat", until: now + 900 }, retreatedAt: now };
        });
        if (changed) apply(next);
      });
    };
    if (moving) win.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      cancelled = true;
      timers.forEach((timer) => win.clearTimeout(timer));
      win.clearTimeout(debounce);
      win.clearTimeout(scrollSettle);
      win.clearInterval(ticker);
      if (frame) win.cancelAnimationFrame(frame);
      win.removeEventListener("resize", onLayout);
      win.removeEventListener("scroll", onScroll);
      win.removeEventListener("mousemove", onMove);
      observer?.disconnect();
      stopWatching();
      tokens.forEach((token) => releaseMotion(token));
      tokens.clear();
    };
  }, [location.pathname, count, seed, salt, moving, walkMin, walkMax]);

  // Netz reißt (#1089): hebt sich die Karte unter einem Netz, reißt es - höchstens einmal je Minute je Karte, nie neben
  // einer anderen großen Reaktion. Nach einer Minute baut die Spinne neu.
  const restRef = useRef(null);
  if (!restRef.current) restRef.current = createRest(REST_MS.big);
  const tearTimers = useRef(new Set());
  const tearTokens = useRef(new Set());
  useEffect(() => () => {
    tearTimers.current.forEach((id) => window.clearTimeout(id));
    tearTimers.current.clear();
    tearTokens.current.forEach((token) => endReaction(token));
    tearTokens.current.clear();
  }, []);
  const setTear = (ids, tear) => {
    websRef.current = websRef.current.map((web) => (ids.includes(web.id) ? { ...web, tear: tear === null ? null : { ...(web.tear || {}), ...tear } } : web));
    setWebs(websRef.current);
  };
  const later = (fn, ms) => {
    const id = window.setTimeout(() => {
      tearTimers.current.delete(id);
      fn();
    }, ms);
    tearTimers.current.add(id);
  };
  useCardSignal((detail) => {
    if (detail.type !== "lift") return;
    const mine = websRef.current.filter((web) => !web.yield && !web.tear && webCard(web) === detail.key);
    if (!mine.length || restRef.current.left(detail.key) > 0) return;
    const token = startReaction();
    if (!token) return;
    restRef.current.take(detail.key);
    tearTokens.current.add(token);
    const now = Date.now();
    const ids = mine.map((web) => web.id);
    websRef.current = websRef.current.map((web) => {
      if (!ids.includes(web.id)) return web;
      const lines = staticLines(buildPlan(web.spec.seed), web.spec.radius, web.side === "tr");
      return { ...web, spider: null, tear: { phase: "tear", at: now, plan: tearPlan(lines, { seed: `${web.key}:${now}`, side: web.side, hub: hubOf(web.spec, web.side) }) } };
    });
    setWebs(websRef.current);
    later(() => {
      setTear(ids, { phase: "gone" });
      endReaction(token);
      tearTokens.current.delete(token);
    }, TEAR.goneAt);
    later(() => setTear(ids, { phase: "build" }), TEAR.rebuildAt);
    later(() => setTear(ids, null), TEAR.rebuildAt + TEAR.buildMs + 400);
  }, webs.length > 0);

  if (typeof document === "undefined" || !webs.length) return null;
  return createPortal(
    <div className="tls-cwebs" aria-hidden="true" data-testid="halloween-corner-webs">
      {webs.map((web) => {
        const left = web.side === "tl" ? web.x : web.x - web.spec.width;
        const hub = hubOf(web.spec, web.side);
        const spiderSize = 8;
        const tear = web.tear ? web.tear.phase : null;
        const spiderStyle = { left: `${(hub.x - spiderSize / 2).toFixed(1)}px`, top: `${(hub.y - spiderSize * 3.3).toFixed(1)}px` };
        return (
          <div
            key={web.id}
            className={`tls-cweb tls-cweb--${web.side}${web.yield ? " tls-cweb--yield" : ""}`}
            style={{ transform: `translate(${left.toFixed(1)}px, ${web.y.toFixed(1)}px)`, width: web.spec.width, height: web.spec.height, "--cweb-opacity": web.spec.opacity }}
            data-testid="halloween-corner-web"
            data-kind={web.kind}
            data-side={web.side}
            data-spider={web.spider ? web.spider.phase : undefined}
            data-yield={web.yield ? "1" : undefined}
            data-season-card={webCard(web) || undefined}
            data-tear={tear || undefined}
          >
            {tear === "tear" && <TornNet spec={web.spec} side={web.side} plan={web.tear.plan} />}
            {tear === "tear" && <Spider size={spiderSize} className="tls-cweb__spider tls-cweb__spider--rappel" style={spiderStyle} data-testid="halloween-corner-spider-rappel" />}
            {tear === "build" && <Net spec={web.spec} side={web.side} build />}
            {tear === "build" && <Spider size={spiderSize} thread={false} className="tls-cweb__spider tls-cweb__spider--build" style={{ ...spiderStyle, "--build-ms": `${TEAR.buildMs}ms` }} />}
            {!tear && <Net spec={web.spec} side={web.side} />}
            {!tear && web.spider && (
              <Spider
                size={spiderSize}
                thread={false}
                className={`tls-cweb__spider tls-cweb__spider--${web.spider.phase}`}
                style={{ left: `${(hub.x - spiderSize / 2).toFixed(1)}px`, top: `${(hub.y - spiderSize * 3.3).toFixed(1)}px`, "--from-x": `${(web.side === "tl" ? -hub.x : web.spec.width - hub.x).toFixed(1)}px`, "--from-y": `${(-hub.y).toFixed(1)}px`, "--walk-seconds": `${WALK_SECONDS}s` }}
                data-testid="halloween-corner-spider"
              />
            )}
          </div>
        );
      })}
    </div>,
    document.body,
  );
}
