import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { hashString, mulberry32 } from "../rng";
import { emitSound } from "../audio";
import { measureQuietZones, overlayZones, rectInQuiet, watchOverlays } from "../quiet";
import { releaseMotion, requestMotion } from "../motion";
import { FlyingBatShape, HangingBatShape, SittingBatShape } from "./art";
import { KIND_WEIGHTS, MIN_DISTANCE, POSE, SHAPE_HEIGHT, choosePerches, measurePerches, nearestFreePerch } from "./perches";
import { MAX_ACTIVE_FLIGHTS, SCROLL_STARTLE_SPEED, activeFlights, advanceBat, alert, createBat, fleePath, pointOn, reactToPointer, reactToScroll, startle } from "./batLife";

// Fledermäuse (#661, Halloween IV H7–H9): sie sitzen auf Kanten und Ecken oder hängen unter ihnen (perches.js),
// leben nach einer kleinen Zustandslogik (batLife.js) und reagieren auf Zeiger und Scrollen. Die Kopfzeile klebt
// oben, also hängen deren Fledermäuse am Fenster; alle anderen scrollen mit ihrem Platz. Ein Klick scheucht wie
// bisher; die Verscheuchte kommt nach einer Weile zu einem freien, sichtbaren Platz zurück. Diese Datei hält nur
// noch DOM, Zeit und Anzeige.

export { KIND_WEIGHTS, MIN_DISTANCE, pointOn };
export const flightPath = fleePath;
export const chooseAnchors = choosePerches;

/** Alte Signatur: das dritte Argument durfte eine Liste von Ruhezonen sein. */
export function measureAnchors(doc, win, zonesOrOptions) {
  return measurePerches(doc, win, Array.isArray(zonesOrOptions) ? { zones: zonesOrOptions } : zonesOrOptions);
}

const REFRESH_DELAYS = [400, 1500, 3500];
const POINTER_EVERY_MS = 120;
const SCROLL_EVERY_MS = 400;
const SCROLL_WINDOW_MS = 200;
const FLYING = new Set(["takeoff", "flying", "approaching", "landing"]);
const AT_PERCH = new Set(["perched", "alert", "settle", "takeoff"]);
const REACTIVE = new Set(["perched", "alert"]);

function shapeHeight(bat) {
  return bat.size * (SHAPE_HEIGHT[bat.pose] || SHAPE_HEIGHT.hang);
}

/** Liegt eine ruhende Fledermaus unter einem geöffneten Dialog oder Menü? Dann weicht sie aus (unsichtbar, nicht klickbar). */
export function yieldsToOverlay(bat, zones) {
  const overlays = overlayZones(zones);
  if (!overlays.length) return false;
  const top = bat.pose === POSE.sit ? bat.y - shapeHeight(bat) : bat.y;
  const rect = { left: bat.x - bat.size / 2, top, right: bat.x + bat.size / 2, bottom: top + shapeHeight(bat) };
  return rectInQuiet(rect, overlays, { fixed: bat.fixed ?? bat.anchor?.fixed ?? false, overlayOnly: true });
}

function viewFor(fixed, win) {
  const top = fixed ? 0 : win.scrollY || 0;
  return { top, bottom: top + win.innerHeight, width: win.innerWidth };
}

function coarsePointer(win) {
  return typeof win.matchMedia === "function" && Boolean(win.matchMedia("(pointer: coarse)").matches);
}

/** Plätze, die eine Fledermaus gerade belegt: ihr Sitzplatz und, im Anflug, ihr Ziel. */
function perchesOf(bat) {
  const held = [];
  if (AT_PERCH.has(bat.state) && bat.perch) held.push(bat.perch);
  if (bat.target) held.push(bat.target);
  return held;
}

function pagePoint(bat, win) {
  return bat.fixed ? { x: bat.x, y: bat.y + (win.scrollY || 0) } : { x: bat.x, y: bat.y };
}

function inView(perch, win) {
  if (!perch || perch.fixed) return true;
  const top = win.scrollY || 0;
  return perch.py >= top - 40 && perch.py <= top + win.innerHeight + 40;
}

function visiblyDifferent(a, b) {
  return a.state !== b.state || a.x !== b.x || a.y !== b.y || a.rotation !== b.rotation || a.yield !== b.yield || a.pose !== b.pose;
}

/**
 * `count` Fledermäuse an den Plätzen der Seite. Gemessen wird kurz nach dem Aufbau und noch zweimal (Schriften und
 * Karten kommen nach), bei Größenänderung, nach dem Scrollen und wenn sich die Seite umbaut; freie Plätze werden
 * dann nachbesetzt, verschwundene Plätze lassen ihre Fledermaus gehen - sie kommt zurück, sobald wieder einer frei
 * ist. `timeScale`, `temperament` und `reactionRng` sind Stellschrauben für Tests.
 */
export function HangingBats({ count, seed, salt, timeScale = 1, temperament = null, reactionRng = null }) {
  const location = useLocation();
  const [bats, setBats] = useState([]);
  const batsRef = useRef([]);
  const rngRef = useRef(mulberry32(hashString(`bats:${seed}:${salt}`)));
  const tokensRef = useRef(new Map());

  useEffect(() => {
    batsRef.current = [];
    setBats([]);
    if (!count || typeof document === "undefined") return undefined;
    const win = window;
    const rng = mulberry32(hashString(`bats:${seed}:${salt}:${location.pathname}`));
    rngRef.current = rng;
    const react = reactionRng || rng;
    const tokens = tokensRef.current;
    let cancelled = false;
    let nextId = 0;
    const apply = (next) => {
      batsRef.current = next;
      setBats(next);
    };
    const holdToken = (bat, kind, options) => {
      const token = requestMotion(kind, options);
      if (!token) return false;
      tokens.set(bat.id, token);
      return true;
    };
    const dropToken = (bat) => {
      releaseMotion(tokens.get(bat.id));
      tokens.delete(bat.id);
    };
    const others = (all, except) => all.filter((bat) => bat !== except).flatMap(perchesOf);
    const heldKeys = (all, except) => new Set(others(all, except).map((perch) => perch.key));

    /** Ein freier, sichtbarer Platz in der Nähe - mit Flugbudget; sonst null. Umziehen bleibt im selben Koordinatenraum. */
    const findPerch = (bat, all) => {
      const zones = measureQuietZones(document, win);
      const candidates = measurePerches(document, win, { zones, taken: heldKeys(all, bat) })
        .filter((perch) => inView(perch, win) && (bat.state === "gone" || perch.fixed === bat.fixed));
      const perch = nearestFreePerch(candidates, pagePoint(bat, win), others(all, bat), rng, { avoidKey: bat.perch?.key });
      if (!perch) return null;
      return holdToken(bat, "bat_flight") ? perch : null;
    };

    const refresh = () => {
      if (cancelled) return;
      const zones = measureQuietZones(document, win);
      const current = batsRef.current;
      let next = current.map((bat) => {
        if (AT_PERCH.has(bat.state) && bat.state !== "takeoff") {
          const point = bat.perch.measure();
          if (!point) return { ...bat, state: "gone", timer: 6 + rng() * 6, path: null, target: null, yield: false };
          const moved = point.x === bat.x && point.y === bat.y ? bat : { ...bat, x: point.x, y: point.y };
          const yielding = yieldsToOverlay(moved, zones);
          return yielding === Boolean(moved.yield) && moved === bat ? bat : { ...moved, yield: yielding };
        }
        if (bat.target && (bat.state === "approaching" || bat.state === "landing")) {
          const point = bat.target.measure();
          if (!point) {
            dropToken(bat);
            return { ...bat, state: "gone", timer: 6 + rng() * 6, path: null, target: null };
          }
          if (point.x === bat.target.x && point.y === bat.target.y) return bat;
          const target = { ...bat.target, x: point.x, y: point.y };
          const landing = bat.state === "landing";
          return { ...bat, target, path: bat.path ? { ...bat.path, p3: { x: point.x, y: point.y } } : bat.path, x: landing ? point.x : bat.x, y: landing ? point.y : bat.y };
        }
        return bat;
      });
      const open = count - next.length;
      if (open > 0) {
        const found = measurePerches(document, win, { zones, taken: heldKeys(next, null) });
        if (found.length) {
          const fresh = choosePerches(found, open, rng, others(next, null)).map((perch) => createBat(nextId++, perch, rng, temperament));
          next = [...next, ...fresh];
        }
      }
      if (next.length !== current.length || next.some((bat, index) => bat !== current[index])) apply(next);
    };

    // Reaktionen (H9): Zeiger höchstens alle 120 ms, Scrollgeschwindigkeit über ein Fenster von 200 ms - keine
    // Messung pro Ereignis, keine teuren DOM-Abfragen; nur ruhende, sichtbare Fledermäuse.
    const pointer = { x: 0, y: 0, at: -Infinity, checkedAt: -Infinity };
    const scrolling = { samples: [], speed: 0, evaluatedAt: -Infinity, pending: false };
    let lastFleeAt = -Infinity;
    let lastScrollStartleAt = -Infinity;

    const step = (dt, now) => {
      const current = batsRef.current;
      if (!current.length) return;
      let changed = false;
      let next = current;
      if (now - pointer.at < 2000 && now - pointer.checkedAt >= POINTER_EVERY_MS) {
        pointer.checkedAt = now;
        next = next.map((bat) => {
          if (!REACTIVE.has(bat.state) || bat.yield) return bat;
          const at = bat.fixed ? { x: pointer.x, y: pointer.y } : { x: pointer.x + (win.scrollX || 0), y: pointer.y + (win.scrollY || 0) };
          const verdict = reactToPointer(bat, at, react, now, lastFleeAt);
          if (verdict === "alert") {
            changed = true;
            return alert(bat, undefined, now);
          }
          if (verdict === "flee" && activeFlights(next) < MAX_ACTIVE_FLIGHTS && holdToken(bat, "bat_flight")) {
            lastFleeAt = now;
            changed = true;
            return startle(bat, rng, viewFor(bat.fixed, win), now);
          }
          return bat;
        });
      }
      if (scrolling.pending) {
        scrolling.pending = false;
        if (reactToScroll(scrolling.speed, react, now, lastScrollStartleAt)) {
          const visible = next.filter((bat) => REACTIVE.has(bat.state) && !bat.yield && inView(bat.perch, win));
          const victim = visible.length && activeFlights(next) < MAX_ACTIVE_FLIGHTS ? visible[Math.floor(rng() * visible.length) % visible.length] : null;
          if (victim && holdToken(victim, "bat_flight")) {
            lastScrollStartleAt = now;
            changed = true;
            next = next.map((bat) => (bat === victim ? startle(bat, rng, viewFor(bat.fixed, win), now) : bat));
          }
        }
      }
      const all = next;
      const env = { rng, viewFor: (fixed) => viewFor(fixed, win), findPerch: (bat) => findPerch(bat, all), canFly: () => activeFlights(all) < MAX_ACTIVE_FLIGHTS };
      next = next.map((bat) => {
        const after = advanceBat(bat, dt, { ...env, view: viewFor(bat.fixed, win) });
        if (after === bat) return bat;
        if (FLYING.has(bat.state) && !FLYING.has(after.state)) dropToken(bat);
        if (visiblyDifferent(bat, after)) changed = true;
        return after;
      });
      batsRef.current = next;
      if (changed) setBats(next);
    };

    let frame = 0;
    let last = performance.now();
    const loop = () => {
      frame = win.requestAnimationFrame(loop);
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000) * timeScale;
      last = now;
      if (document.hidden) return;
      step(dt, now);
    };
    frame = win.requestAnimationFrame(loop);

    const timers = REFRESH_DELAYS.map((ms) => win.setTimeout(refresh, ms));
    let debounce = 0;
    const onLayout = () => {
      win.clearTimeout(debounce);
      debounce = win.setTimeout(refresh, 200);
    };
    win.addEventListener("resize", onLayout);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onLayout) : null;
    observer?.observe(document.body);
    // Dialoge und Menüs (H10): öffnet sich eines über einer Fledermaus, weicht sie aus - und kommt zurück, wenn es zugeht.
    const stopWatching = watchOverlays(refresh);
    const onMove = (event) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.at = performance.now();
    };
    const fine = !coarsePointer(win);
    if (fine) win.addEventListener("mousemove", onMove, { passive: true });
    let scrollSettle = 0;
    const onScroll = () => {
      const now = performance.now();
      const y = win.scrollY || 0;
      scrolling.samples = scrolling.samples.filter((sample) => now - sample.at <= SCROLL_WINDOW_MS);
      scrolling.samples.push({ y, at: now });
      const oldest = scrolling.samples[0];
      const seconds = (now - oldest.at) / 1000;
      scrolling.speed = seconds >= 0.1 ? Math.abs(y - oldest.y) / seconds : 0;
      if (scrolling.speed >= SCROLL_STARTLE_SPEED && now - scrolling.evaluatedAt >= SCROLL_EVERY_MS) {
        scrolling.evaluatedAt = now;
        scrolling.pending = true;
      }
      win.clearTimeout(scrollSettle);
      scrollSettle = win.setTimeout(refresh, 300);
    };
    win.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      cancelled = true;
      win.cancelAnimationFrame(frame);
      timers.forEach((timer) => win.clearTimeout(timer));
      win.clearTimeout(debounce);
      win.clearTimeout(scrollSettle);
      win.removeEventListener("resize", onLayout);
      if (fine) win.removeEventListener("mousemove", onMove);
      win.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      stopWatching();
      tokens.forEach((token) => releaseMotion(token));
      tokens.clear();
    };
  }, [location.pathname, count, seed, salt, timeScale, temperament, reactionRng]);

  const scare = (id) => {
    const bat = batsRef.current.find((candidate) => candidate.id === id);
    if (!bat || !REACTIVE.has(bat.state)) return;
    const token = requestMotion("bat_scare", { force: true });
    if (token) tokensRef.current.set(id, token);
    emitSound("bat_scare");
    const now = performance.now();
    batsRef.current = batsRef.current.map((candidate) => (candidate.id === id ? startle(candidate, rngRef.current, viewFor(candidate.fixed, window), now) : candidate));
    setBats(batsRef.current);
  };

  if (typeof document === "undefined") return null;
  const alive = bats.filter((bat) => bat.state !== "gone");
  if (!alive.length) return null;
  const renderBat = (bat) => {
    if (bat.state === "flying" || bat.state === "approaching") {
      const size = bat.size * 1.7;
      const transform = `translate(${(bat.x - size / 2).toFixed(1)}px, ${(bat.y - size * 0.275).toFixed(1)}px) rotate(${(bat.rotation || 0).toFixed(1)}deg) scaleX(${bat.facing || 1})`;
      return (
        <div key={bat.id} className="tls-hbat tls-hbat--flying" style={{ transform }} data-testid="halloween-bat-flying" data-state={bat.state}>
          <FlyingBatShape size={size} />
        </div>
      );
    }
    const sitting = bat.pose === POSE.sit;
    const top = sitting ? bat.y - shapeHeight(bat) : bat.y;
    const perch = bat.target || bat.perch;
    return (
      <button
        key={bat.id}
        type="button"
        tabIndex={-1}
        className={`tls-hbat ${sitting ? "tls-hbat--sitting" : "tls-hbat--hanging"} tls-hbat--${bat.state}${bat.yield ? " tls-hbat--yield" : ""}`}
        style={{ transform: `translate(${(bat.x - bat.size / 2).toFixed(1)}px, ${top.toFixed(1)}px)` }}
        onClick={() => scare(bat.id)}
        data-testid="halloween-bat-hanging"
        data-kind={perch?.kind}
        data-pose={bat.pose}
        data-state={bat.state}
        data-temperament={bat.temperament}
        data-yield={bat.yield ? "1" : undefined}
      >
        {sitting ? <SittingBatShape size={bat.size} /> : <HangingBatShape size={bat.size} />}
      </button>
    );
  };
  const fixedBats = alive.filter((bat) => bat.fixed);
  const pageBats = alive.filter((bat) => !bat.fixed);
  return createPortal(
    <>
      {fixedBats.length > 0 && <div className="tls-hbats tls-hbats--fixed" aria-hidden="true" data-testid="halloween-hanging-bats-fixed">{fixedBats.map(renderBat)}</div>}
      {pageBats.length > 0 && <div className="tls-hbats tls-hbats--page" aria-hidden="true" data-testid="halloween-hanging-bats">{pageBats.map(renderBat)}</div>}
    </>,
    document.body,
  );
}
