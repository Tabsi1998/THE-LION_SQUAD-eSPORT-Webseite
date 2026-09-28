import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { hashString, mulberry32 } from "../rng";
import { FlyingBatShape, HangingBatShape } from "./art";

// Hängende Fledermäuse (#661, Runde V): sie hängen still - unter einem Menüpunkt der Kopfzeile, an einem
// Buchstaben der letzten Zeile einer Überschrift (genau an der Unterkante des Zeichens gemessen), an der
// Oberkante einer News- oder Vorstandskarte oder am Löwen. Die Kopfzeile klebt oben, also hängen diese
// Fledermäuse am Fenster fest; alle anderen hängen in der Seite und scrollen mit ihrem Anker. Nichts wackelt
// von sich aus: erst ein Klick scheucht sie, dann fliegen sie auf einer Kurve aus dem Bild.

export const NAV_SELECTOR = "header nav a";
export const HEADING_SELECTOR = "main h1, main h2";
export const CARD_SELECTOR = "[data-season-anchor='card']";
export const LION_SELECTOR = "[data-season-anchor='lion']";
export const MIN_DISTANCE = 140;
/** Wie oft welche Art drankommt, wenn es sie auf der Seite gibt. */
export const KIND_WEIGHTS = { nav: 0.35, glyph: 0.3, card: 0.25, lion: 0.1 };
const GLYPH = /[A-Za-z0-9ÄÖÜäöüß]/;
const MAX_HEADINGS = 6;

function scrollOf(win) {
  return { x: (win && win.scrollX) || 0, y: (win && win.scrollY) || 0 };
}

function clampSize(value) {
  return Math.round(Math.max(18, Math.min(30, value)));
}

/** Das Rechteck eines einzelnen Zeichens - über einen Range; ohne Layout (Tests, alte Browser) nichts. */
function glyphRect(doc, node, index) {
  if (typeof doc.createRange !== "function") return null;
  const range = doc.createRange();
  range.setStart(node, index);
  range.setEnd(node, index + 1);
  if (typeof range.getBoundingClientRect !== "function") return null;
  const rect = range.getBoundingClientRect();
  return rect && rect.width >= 6 && rect.height >= 16 ? rect : null;
}

function navAnchors(doc, win) {
  const found = [];
  const at = scrollOf(win);
  doc.querySelectorAll(NAV_SELECTOR).forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 24 || rect.height < 10 || rect.top > 160) return;
    const measure = () => {
      if (!element.isConnected) return null;
      const again = element.getBoundingClientRect();
      return again.width < 24 ? null : { x: again.left + again.width / 2, y: again.bottom + 2 };
    };
    const point = measure();
    found.push({ kind: "nav", fixed: true, element, ...point, px: point.x + at.x, py: point.y + at.y, size: 24, measure });
  });
  return found;
}

/** Buchstaben der letzten Zeile jeder Überschrift: die Fledermaus greift die Unterkante des Zeichens. */
function glyphAnchors(doc, win) {
  const found = [];
  const at = scrollOf(win);
  const headings = Array.from(doc.querySelectorAll(HEADING_SELECTOR)).slice(0, MAX_HEADINGS);
  headings.forEach((heading) => {
    const glyphs = [];
    const walker = doc.createTreeWalker(heading, 4 /* NodeFilter.SHOW_TEXT */);
    let node = walker.nextNode();
    while (node) {
      const text = node.textContent || "";
      for (let index = 0; index < text.length; index += 1) {
        if (!GLYPH.test(text[index])) continue;
        const rect = glyphRect(doc, node, index);
        if (rect) glyphs.push({ node, index, rect });
      }
      node = walker.nextNode();
    }
    if (!glyphs.length) return;
    const bottom = Math.max(...glyphs.map((glyph) => glyph.rect.bottom));
    glyphs.filter((glyph) => glyph.rect.bottom > bottom - 3).forEach((glyph) => {
      const measure = () => {
        if (!glyph.node.isConnected) return null;
        const again = glyphRect(doc, glyph.node, glyph.index);
        if (!again) return null;
        const now = scrollOf(win);
        return { x: again.left + again.width / 2 + now.x, y: again.bottom - 1 + now.y };
      };
      const x = glyph.rect.left + glyph.rect.width / 2 + at.x;
      const y = glyph.rect.bottom - 1 + at.y;
      found.push({ kind: "glyph", fixed: false, element: heading, x, y, px: x, py: y, size: clampSize(glyph.rect.height * 0.38), measure });
    });
  });
  return found;
}

/** Karten (News, Vorstand): an der Oberkante, an einer je Karte festen Stelle zwischen 20 und 80 % der Breite. */
function cardAnchors(doc, win) {
  const found = [];
  doc.querySelectorAll(CARD_SELECTOR).forEach((element, index) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 120 || rect.height < 60) return;
    const fraction = 0.2 + ((hashString(`${index}:${(element.textContent || "").slice(0, 40)}`) % 1000) / 1000) * 0.6;
    const measure = () => {
      if (!element.isConnected) return null;
      const again = element.getBoundingClientRect();
      if (again.width < 120) return null;
      const now = scrollOf(win);
      return { x: again.left + again.width * fraction + now.x, y: again.top + 1 + now.y };
    };
    const point = measure();
    found.push({ kind: "card", fixed: false, element, ...point, px: point.x, py: point.y, size: 24, measure });
  });
  return found;
}

function lionAnchors(doc, win) {
  const found = [];
  doc.querySelectorAll(LION_SELECTOR).forEach((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.width < 80 || rect.height < 80) return;
    const measure = () => {
      if (!element.isConnected) return null;
      const again = element.getBoundingClientRect();
      if (again.width < 80) return null;
      const now = scrollOf(win);
      return { x: again.left + again.width * 0.68 + now.x, y: again.top + again.height * 0.16 + now.y };
    };
    const point = measure();
    found.push({ kind: "lion", fixed: false, element, ...point, px: point.x, py: point.y, size: 26, measure });
  });
  return found;
}

/**
 * Alle Hängepunkte der Seite. `fixed` heißt: hängt am Fenster (Kopfzeile), `x`/`y` sind dann Fensterkoordinaten,
 * sonst Seitenkoordinaten; `px`/`py` sind immer Seitenkoordinaten (für Abstände), `measure()` misst frisch nach
 * und liefert null, wenn der Anker verschwunden ist.
 */
export function measureAnchors(doc = document, win = typeof window === "undefined" ? null : window) {
  return [...navAnchors(doc, win), ...glyphAnchors(doc, win), ...cardAnchors(doc, win), ...lionAnchors(doc, win)];
}

/** Auswahl: erst die Art nach Gewicht, dann ein Punkt dieser Art - nie zwei näher als der Mindestabstand (auch zu `taken`). */
export function chooseAnchors(candidates, count, rng, taken = []) {
  const chosen = [];
  const pools = new Map();
  candidates.forEach((candidate) => {
    const key = candidate.kind || "any";
    if (!pools.has(key)) pools.set(key, []);
    pools.get(key).push(candidate);
  });
  const farEnough = (candidate) => [...taken, ...chosen].every((other) => Math.hypot((other.px ?? other.x) - (candidate.px ?? candidate.x), (other.py ?? other.y) - (candidate.py ?? candidate.y)) >= MIN_DISTANCE);
  for (let n = 0; n < count; n += 1) {
    const kinds = [...pools.keys()].filter((kind) => pools.get(kind).some(farEnough));
    if (!kinds.length) break;
    const weightOf = (kind) => KIND_WEIGHTS[kind] || 0.1;
    let roll = rng() * kinds.reduce((sum, kind) => sum + weightOf(kind), 0);
    let kind = kinds[kinds.length - 1];
    for (let i = 0; i < kinds.length; i += 1) {
      roll -= weightOf(kinds[i]);
      if (roll <= 0) {
        kind = kinds[i];
        break;
      }
    }
    const options = pools.get(kind).filter(farEnough);
    chosen.push(options[Math.min(options.length - 1, Math.floor(rng() * options.length))]);
  }
  return chosen;
}

/** Flugbahn beim Verscheuchen: erst ein Stück hoch, dann weit weg - meist unten aus dem Bild, sonst oben. */
export function flightPath(from, rng, view = { top: 0, bottom: 800, width: 1280 }) {
  const dir = rng() < 0.5 ? -1 : 1;
  const dx = dir * (400 + rng() * 500);
  const endY = rng() < 0.62 ? view.bottom + 120 + rng() * 200 : view.top - 120 - rng() * 120;
  const dy = endY - from.y;
  return {
    p0: from,
    p1: { x: from.x + dx * 0.25, y: from.y - 110 - rng() * 60 },
    p2: { x: from.x + dx * 0.75, y: from.y + dy - 120 },
    p3: { x: from.x + dx, y: from.y + dy },
    facing: dir,
  };
}

export function pointOn(path, t) {
  const u = 1 - t;
  return {
    x: u * u * u * path.p0.x + 3 * u * u * t * path.p1.x + 3 * u * t * t * path.p2.x + t * t * t * path.p3.x,
    y: u * u * u * path.p0.y + 3 * u * u * t * path.p1.y + 3 * u * t * t * path.p2.y + t * t * t * path.p3.y,
  };
}

function FlyingBat({ path, durationMs, size, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    let frame = 0;
    const start = performance.now();
    const tick = () => {
      const t = Math.min(1, (performance.now() - start) / durationMs);
      const point = pointOn(path, t);
      if (ref.current) ref.current.style.transform = `translate(${(point.x - size * 0.85).toFixed(1)}px, ${(point.y - size * 0.47).toFixed(1)}px) scaleX(${path.facing})`;
      if (t < 1) frame = requestAnimationFrame(tick);
      else onDone();
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [path, durationMs, size, onDone]);
  return (
    <div ref={ref} className="tls-hbat tls-hbat--flying" style={{ transform: `translate(${path.p0.x - size * 0.85}px, ${path.p0.y - size * 0.47}px)` }} data-testid="halloween-bat-flying">
      <FlyingBatShape size={size * 1.7} />
    </div>
  );
}

/**
 * `count` Fledermäuse an den Ankern der Seite. Gemessen wird kurz nach dem Aufbau und noch zweimal (Schriften
 * und Karten kommen nach), bei Größenänderung und wenn sich die Seite umbaut (ResizeObserver); freie Plätze werden
 * dann nachbesetzt, verschwundene Anker lassen ihre Fledermaus lautlos gehen. Danach hängt alles still.
 */
export function HangingBats({ count, seed, salt, flightMs = 3000 }) {
  const location = useLocation();
  const [bats, setBats] = useState([]);
  const batsRef = useRef([]);
  const rngRef = useRef(mulberry32(hashString(`bats:${seed}:${salt}`)));

  useEffect(() => {
    batsRef.current = [];
    setBats([]);
    if (!count || typeof document === "undefined") return undefined;
    rngRef.current = mulberry32(hashString(`bats:${seed}:${salt}:${location.pathname}`));
    let cancelled = false;
    let placed = 0;
    let nextId = 0;
    const apply = (next) => {
      batsRef.current = next;
      setBats(next);
    };
    const refresh = () => {
      if (cancelled) return;
      let next = batsRef.current.map((bat) => {
        if (bat.state !== "hanging") return bat;
        const point = bat.anchor.measure();
        if (!point) return { ...bat, state: "gone" };
        return point.x === bat.x && point.y === bat.y ? bat : { ...bat, x: point.x, y: point.y };
      });
      const open = count - placed;
      if (open > 0) {
        const found = measureAnchors();
        if (found.length) {
          const taken = next.filter((bat) => bat.state === "hanging").map((bat) => bat.anchor);
          const fresh = chooseAnchors(found, open, rngRef.current, taken).map((anchor) => ({ id: nextId++, anchor, x: anchor.x, y: anchor.y, size: anchor.size, state: "hanging" }));
          placed += fresh.length;
          next = [...next, ...fresh];
        }
      }
      if (next !== batsRef.current) apply(next);
    };
    const timers = [400, 1500, 3500].map((ms) => window.setTimeout(refresh, ms));
    let debounce = 0;
    const onLayout = () => {
      window.clearTimeout(debounce);
      debounce = window.setTimeout(refresh, 200);
    };
    window.addEventListener("resize", onLayout);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(onLayout) : null;
    observer?.observe(document.body);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(debounce);
      window.removeEventListener("resize", onLayout);
      observer?.disconnect();
    };
  }, [location.pathname, count, seed, salt]);

  const update = (mapper) => {
    batsRef.current = batsRef.current.map(mapper);
    setBats(batsRef.current);
  };
  const scare = (id) => {
    const scrollY = window.scrollY || 0;
    update((bat) => {
      if (bat.id !== id || bat.state !== "hanging") return bat;
      const top = bat.anchor.fixed ? 0 : scrollY;
      const view = { top, bottom: top + window.innerHeight, width: window.innerWidth };
      return { ...bat, state: "flying", path: flightPath({ x: bat.x, y: bat.y }, rngRef.current, view) };
    });
  };
  const done = (id) => update((bat) => (bat.id === id ? { ...bat, state: "gone" } : bat));

  if (typeof document === "undefined") return null;
  const alive = bats.filter((bat) => bat.state !== "gone");
  if (!alive.length) return null;
  const renderBat = (bat) => {
    if (bat.state === "flying") return <FlyingBat key={bat.id} path={bat.path} durationMs={flightMs} size={bat.size} onDone={() => done(bat.id)} />;
    return (
      <button
        key={bat.id}
        type="button"
        tabIndex={-1}
        className="tls-hbat tls-hbat--hanging"
        style={{ transform: `translate(${(bat.x - bat.size / 2).toFixed(1)}px, ${bat.y.toFixed(1)}px)` }}
        onClick={() => scare(bat.id)}
        data-testid="halloween-bat-hanging"
        data-kind={bat.anchor.kind}
      >
        <HangingBatShape size={bat.size} />
      </button>
    );
  };
  const fixedBats = alive.filter((bat) => bat.anchor.fixed);
  const pageBats = alive.filter((bat) => !bat.anchor.fixed);
  return createPortal(
    <>
      {fixedBats.length > 0 && <div className="tls-hbats tls-hbats--fixed" aria-hidden="true" data-testid="halloween-hanging-bats-fixed">{fixedBats.map(renderBat)}</div>}
      {pageBats.length > 0 && <div className="tls-hbats tls-hbats--page" aria-hidden="true" data-testid="halloween-hanging-bats">{pageBats.map(renderBat)}</div>}
    </>,
    document.body,
  );
}
