import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { between, pageRng, pick } from "../rng";
import { Cat, Cobweb, Lantern, Moon, Pumpkin, Spider, Tombstone, segmentEnd, webSegments } from "./art";
import { advanceFlock, createFlock, drawBat, nextFlightDelay } from "./bats";
import { advanceLeaves, createLeaves, drawLeaf } from "./leaves";
import { recordSignal } from "../signals";
import "./halloween.css";

// Halloween (#635, #655, #658): dunkel und edel. Ein großes Eck-Netz, das eine Spinne beim ersten Besuch
// sichtbar spinnt - Faden für Faden, bis an den Rand verankert; eine Spinne, die sich ab und zu abseilt,
// selten eine, die über den Bildschirm krabbelt; wenige Fledermäuse als Silhouetten; ein ruhiger Mond;
// selten ein einzelner Grabstein; ein bis zwei Kürbisse am Footer und die Laterne neben dem Löwen.
// Kein Nebel, keine Geister, keine Lichterketten. Jede Seite bekommt aus ihrer Adresse ihre Anordnung.

export const ACCENT = "rgba(170, 225, 240, 0.35)";
export const SIGNAL_KEY = "halloween_pumpkin";
export const FACES = ["grin", "calm", "wicked"];

/** Zählt der Klick? Nur am 31. Oktober ab 18:00 (Ortszeit des Geräts, der Server prüft später selbst). */
export function pumpkinCounts(now = new Date()) {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

/** Was diese Seite bekommt - aus der Adresse berechnet: gleiche Seite, gleiches Bild; andere Seite, anderes Bild. */
export function pageLayout(pathname, intensity = "normal") {
  const rng = pageRng(pathname, "halloween");
  const full = intensity === "full";
  const subtle = intensity === "subtle";
  const mainCorner = rng() < 0.7 ? "tl" : "tr";
  const webs = [{ corner: mainCorner, scale: between(rng, 1.0, 1.35), seed: rng(), build: !subtle && rng() < 0.65, stepMs: Math.round(between(rng, 260, 420)) }];
  if (rng() < 0.45) webs.push({ corner: mainCorner === "tl" ? "tr" : "tl", scale: between(rng, 0.55, 0.8), seed: rng(), build: false, stepMs: 0 });
  const spiders = subtle ? [] : [{ side: mainCorner === "tl" ? "left" : "right", period: between(rng, 45, 80), delay: between(rng, 25, 40), size: between(rng, 22, 30), drop: between(rng, 110, 200) }];
  const crawler = !subtle && (full || rng() < 0.6) ? { every: between(rng, 150, 320), first: between(rng, 40, 90), size: between(rng, 26, 36), duration: between(rng, 16, 26) } : null;
  // Abseil-Spinne (#658): hängt in der Seite, nicht im Fenster - sie seilt sich langsam nach unten ab, man kann ihr nachscrollen.
  const rappel = !subtle && rng() < 0.45 ? { side: mainCorner === "tl" ? "right" : "left", size: between(rng, 20, 28), speed: between(rng, 14, 26), first: between(rng, 8, 20), rest: between(rng, 20, 45) } : null;
  const footerPumpkins = [{ face: pick(rng, FACES), size: Math.round(between(rng, 46, 60)) }];
  if (rng() < 0.5) footerPumpkins.push({ face: pick(rng, FACES), size: Math.round(between(rng, 34, 44)), slow: true });
  const tombstone = rng() < 0.35 ? { side: pick(rng, ["left", "right"]), size: Math.round(between(rng, 64, 84)), tilt: between(rng, -5, 5) } : null;
  const moon = !subtle && rng() < 0.7 ? { side: mainCorner === "tl" ? "right" : "left" } : null;
  const flock = full ? [5, 8] : [3, 5];
  const cat = rng() < 0.5 ? { size: Math.round(between(rng, 56, 72)) } : null;
  const leaves = subtle ? 0 : full ? 6 + Math.floor(rng() * 4) : 3 + Math.floor(rng() * 3);
  return { webs, spiders, crawler, rappel, footerPumpkins, tombstone, moon, flock, cat, leaves, lanternFace: pick(rng, FACES), night: false };
}

function useLayout(season) {
  const location = useLocation();
  return useMemo(() => ({ ...pageLayout(location.pathname, season.effective), night: Boolean(season.data?.night) }), [location.pathname, season.effective, season.data?.night]);
}

const CORNER_CLASS = { tl: "tls-web--tl", tr: "tls-web--tr" };

/** Ein Element, das nach einer Wartezeit immer wieder für `duration` Sekunden erscheint (Krabbler). */
function useRecurring(spec, active) {
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    if (!spec || !active) return undefined;
    let timer = 0;
    let stopped = false;
    const show = () => {
      if (stopped) return;
      setVisible(true);
      timer = window.setTimeout(() => {
        setVisible(false);
        timer = window.setTimeout(show, spec.every * 1000);
      }, (spec.duration || 16) * 1000);
    };
    timer = window.setTimeout(show, spec.first * 1000);
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, [spec, active]);
  return visible;
}

/** Netzbau (#658): die Spinne spinnt das Netz Faden für Faden; sie sitzt am Ende des Fadens, den sie gerade zieht. */
export function BuildingWeb({ web, corner, reducedMotion }) {
  const segments = useMemo(() => webSegments(web.seed), [web.seed]);
  const [count, setCount] = useState(reducedMotion || !web.build ? segments.length : 0);
  useEffect(() => {
    if (reducedMotion || !web.build) return undefined;
    const handle = window.setInterval(() => setCount((current) => (current >= segments.length ? current : current + 1)), web.stepMs);
    return () => window.clearInterval(handle);
  }, [reducedMotion, web.build, web.stepMs, segments.length]);
  const building = count < segments.length;
  const tip = building ? segmentEnd(segments[Math.max(0, count - 1)]) : null;
  const scale = web.scale;
  return (
    <div className={`tls-web ${CORNER_CLASS[corner]}`} style={{ "--web-scale": scale }} data-testid={building ? "halloween-web-building" : "halloween-web"}>
      <Cobweb seed={web.seed} progress={count / segments.length} />
      {building && tip && (
        <div className="tls-web__spinner" style={{ left: `${(tip.x / 240) * 100}%`, top: `${(tip.y / 240) * 100}%` }} aria-hidden="true">
          <Spider size={12} thread={false} className="tls-spider--spinning" />
        </div>
      )}
    </div>
  );
}

/** Scrollen bewegt die Deko mit: das Netz schwingt nach der Scrollgeschwindigkeit, der Mond wandert langsam. */
export function useScrollEffects(active) {
  const location = useLocation();
  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const root = document.documentElement;
    let last = window.scrollY;
    let sway = 0;
    let frame = 0;
    const tick = () => {
      sway *= 0.9;
      root.style.setProperty("--season-sway", `${sway.toFixed(3)}deg`);
      if (Math.abs(sway) > 0.02) frame = window.requestAnimationFrame(tick);
      else {
        root.style.setProperty("--season-sway", "0deg");
        frame = 0;
      }
    };
    const onScroll = () => {
      const now = window.scrollY;
      const velocity = Math.max(-60, Math.min(60, now - last));
      last = now;
      sway = Math.max(-4, Math.min(4, sway + velocity * 0.04));
      root.style.setProperty("--season-scroll", `${Math.round(now)}px`);
      if (!frame) frame = window.requestAnimationFrame(tick);
    };
    root.style.setProperty("--season-scroll", `${Math.round(window.scrollY)}px`);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
      root.style.removeProperty("--season-sway");
      root.style.removeProperty("--season-scroll");
    };
  }, [active]);
  // Seitenwechsel: die Fledermäuse dürfen kurz darauf starten.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("tls:season-page", { detail: { pathname: location.pathname } }));
    } catch {
      // ohne CustomEvent kein Start beim Seitenwechsel - der Zeitplan bleibt.
    }
  }, [location.pathname]);
}

/** Die Abseil-Spinne (#658): sitzt in der Seite, nicht im Fenster. Sie seilt sich langsam bis unten ab - wer scrollt,
 * findet sie weiter unten am Faden - rastet, und klettert schneller wieder hoch. */
export function RappellingSpider({ spec, active }) {
  const [top, setTop] = useState(90);
  useEffect(() => {
    if (!spec || !active || typeof window === "undefined") return undefined;
    let y = 90;
    let direction = 1;
    let waitUntil = performance.now() + spec.first * 1000;
    let last = performance.now();
    let frame = 0;
    // Eigene Uhr statt des rAF-Zeitstempels: der zählt je nach Umgebung ab einem anderen Nullpunkt.
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (now >= waitUntil) {
        const floor = Math.max(300, document.documentElement.scrollHeight - 260);
        y += direction * spec.speed * (direction > 0 ? 1 : 2.4) * dt;
        if (y >= floor) {
          y = floor;
          direction = -1;
          waitUntil = now + spec.rest * 1000;
        } else if (y <= 90) {
          y = 90;
          direction = 1;
          waitUntil = now + spec.rest * 2 * 1000;
        }
        setTop(Math.round(y));
      }
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [spec, active]);
  if (!spec || !active || typeof document === "undefined") return null;
  return createPortal(
    <div className={`tls-rappel tls-rappel--${spec.side}`} style={{ height: `${top}px` }} aria-hidden="true" data-testid="halloween-rappel">
      <Spider size={spec.size} className="tls-rappel__spider" />
    </div>,
    document.body,
  );
}

export function Corners({ season }) {
  const layout = useLayout(season);
  const moving = season.effective !== "subtle";
  const crawling = useRecurring(layout.crawler, moving);
  useScrollEffects(moving);
  return (
    <>
      {layout.webs.map((web) => <BuildingWeb key={web.corner} web={web} corner={web.corner} reducedMotion={!moving} />)}
      {layout.spiders.map((spider) => (
        <Spider key={spider.side} className={`tls-spider--drop tls-spider--${spider.side}`} size={spider.size} style={{ "--spider-period": `${spider.period}s`, "--spider-delay": `${spider.delay}s`, "--spider-drop": `${spider.drop}px` }} data-testid={`halloween-spider-${spider.side}`} />
      ))}
      {crawling && layout.crawler && (
        <Spider className="tls-crawler" size={layout.crawler.size} thread={false} style={{ "--crawl-duration": `${layout.crawler.duration}s` }} data-testid="halloween-crawler" />
      )}
      {layout.tombstone && <Tombstone className={`tls-tombstone--${layout.tombstone.side}`} size={layout.tombstone.size} style={{ "--tilt": `${layout.tombstone.tilt}deg` }} />}
      <RappellingSpider spec={layout.rappel} active={moving} />
    </>
  );
}

export function Backdrop({ season }) {
  const layout = useLayout(season);
  if (!layout.moon) return null;
  return <Moon className={`tls-moon--${layout.moon.side}`} />;
}

export function Footer({ season }) {
  const layout = useLayout(season);
  return (
    <>
      {layout.cat && <div className="tls-footer-cat" data-testid="halloween-cat"><Cat size={layout.cat.size} /></div>}
      <div className="tls-footer-pumpkins" data-testid="halloween-pumpkins">
        {layout.footerPumpkins.map((pumpkin, index) => <Pumpkin key={index} size={pumpkin.size} face={pumpkin.face} slow={pumpkin.slow} />)}
      </div>
    </>
  );
}

/** Die Pupillen der Laterne schauen zum Mauszeiger - ein paar Pixel, mehr nicht. */
export function eyeOffset(pointer, center, reach = 2.2) {
  const dx = pointer.x - center.x;
  const dy = pointer.y - center.y;
  const distance = Math.hypot(dx, dy) || 1;
  const pull = Math.min(1, distance / 220);
  return { x: (dx / distance) * reach * pull, y: (dy / distance) * reach * pull };
}

export function Widget({ season }) {
  const layout = useLayout(season);
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  const buttonRef = useRef(null);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (typeof window === "undefined" || season.effective === "subtle") return undefined;
    let frame = 0;
    const onMove = (event) => {
      if (frame || !buttonRef.current) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const box = buttonRef.current?.getBoundingClientRect();
        if (!box) return;
        const offset = eyeOffset({ x: event.clientX, y: event.clientY }, { x: box.left + box.width / 2, y: box.top + box.height / 2 });
        buttonRef.current.style.setProperty("--eye-x", `${offset.x.toFixed(2)}px`);
        buttonRef.current.style.setProperty("--eye-y", `${offset.y.toFixed(2)}px`);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [season.effective]);
  const greeting = season.texts?.greeting || "Happy Halloween";
  const onClick = () => {
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 4000);
    if (pumpkinCounts()) recordSignal(SIGNAL_KEY);
  };
  return (
    <span className="relative">
      <button ref={buttonRef} type="button" onClick={onClick} className={`tls-lantern ${open ? "tls-lantern--open" : ""}`} aria-label={greeting} title={greeting} data-testid="halloween-lantern">
        <Lantern open={open} face={layout.lanternFace} />
      </button>
      {open && <span className="tls-lantern__note" role="status" data-testid="halloween-note">{greeting}</span>}
    </span>
  );
}

/** Die Fledermäuse als Ebene für den gemeinsamen Canvas-Loop - wenige, als Silhouetten, erster Flug nach sechs Sekunden. */
export function skyLayers({ season, reducedMotion }) {
  if (reducedMotion || season.effective === "subtle") return [];
  const night = Boolean(season.data?.night);
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const rng = pageRng(pathname, "bats");
  const layout = pageLayout(pathname, season.effective);
  const state = { flock: null, wait: 6, lastPath: pathname, pageArmed: true, leaves: null };
  // Seitenwechsel: ein Schwarm darf kurz darauf starten - höchstens einmal je Minute.
  const onPage = (event) => {
    const path = event?.detail?.pathname || "";
    if (!state.pageArmed || path === state.lastPath) return;
    state.lastPath = path;
    state.pageArmed = false;
    if (!state.flock) state.wait = Math.min(state.wait, 1.5);
    window.setTimeout(() => {
      state.pageArmed = true;
    }, 60000);
  };
  if (typeof window !== "undefined") window.addEventListener("tls:season-page", onPage);
  const leafLayer = layout.leaves > 0 ? [{
    key: "halloween-leaves",
    draw(ctx, dt, size) {
      if (!state.leaves) state.leaves = createLeaves(size, layout.leaves, rng);
      advanceLeaves(state.leaves, dt, size, rng).forEach((leaf) => drawLeaf(ctx, leaf));
    },
  }] : [];
  return [...leafLayer, {
    key: "halloween-bats",
    draw(ctx, dt, size) {
      if (!state.flock) {
        state.wait -= dt;
        if (state.wait > 0) return;
        state.flock = createFlock(size, layout.flock, rng);
        dt = Math.max(0, -state.wait);
        state.wait = 0;
      }
      advanceFlock(state.flock, dt).forEach((bat) => drawBat(ctx, bat));
      if (state.flock.done) {
        state.flock = null;
        state.wait = nextFlightDelay(night, rng);
      }
    },
    dispose() {
      if (typeof window !== "undefined") window.removeEventListener("tls:season-page", onPage);
    },
  }];
}

export const season = { key: "halloween", accent: ACCENT, Corners, Backdrop, Footer, Widget, skyLayers };
