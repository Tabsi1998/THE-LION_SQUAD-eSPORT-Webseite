import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { between, pageRng, pick } from "../rng";
import { Cat, CatWalking, Lantern, Moon, Pumpkin, Spider } from "./art";
import { advanceFlock, createFlock, drawBat, nextFlightDelay } from "./bats";
import { HangingBats } from "./HangingBats";
import { Graveyard, useFooterLineTop } from "./graveyard";
import { advanceRappel, createRappel, rappelView } from "./rappel";
import { EXTENT, buildPlan, createWebLayer, staticLines, webRadius } from "./web";
import { advanceWisp, createWisp, drawWisp, nextWispDelay } from "./wisps";
import { recordSignal } from "../signals";
import "./halloween.css";

// Halloween (#635, #655, #658, #660–#664, Runde IV): dunkel und edel, und man kann Dingen beim Entstehen zuschauen.
// Ein rundes Netz hängt an Fäden in der Ecke - mit Physik (Zeiger, Scrollen, Wind) - und wird auf vielen Seiten
// sichtbar gesponnen. Fledermäuse hängen an Überschriften und fliegen beim Klick davon; der Schwarm fliegt in
// Seitenkoordinaten quer, in Sturzflügen nach unten oder von unten aufsteigend, so dass man nachscrollen kann.
// Eine Spinne seilt sich auf jeder Seite bis zum Fußzeilen-Strich ab und lässt los, die Spinne am Faden hängt am
// oberen Seitenrand (scrollt mit der Seite weg); auf dem Strich steht ein winziger Friedhof, dessen Gräber Geister
// freigeben, und eine Katze, die beim Klick ein Stück weiterläuft. Dazu Schwaden im Himmel, der Mond mit echter
// Phase, Kürbisse. Jede Ladung würfelt die Anordnung neu (Adresse plus Salz je Ladung).

export const ACCENT = "rgba(170, 225, 240, 0.35)";
export const SIGNAL_KEY = "halloween_pumpkin";
export const FACES = ["grin", "calm", "wicked"];
/** Salz je Ladung: die ganze Anordnung würfelt sich bei jedem Laden neu - innerhalb einer Sitzung bleibt sie je Seite. */
export const LOAD_SALT = Math.random().toString(36).slice(2, 8);

/** Zählt der Klick? Nur am 31. Oktober ab 18:00 (Ortszeit des Geräts, der Server prüft später selbst). */
export function pumpkinCounts(now = new Date()) {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

/** Was diese Seite bekommt - aus Adresse und Ladungs-Salz berechnet: gleiche Seite in dieser Sitzung gleich, jede Ladung neu. */
export function pageLayout(pathname, intensity = "normal", salt = LOAD_SALT) {
  const rng = pageRng(`${pathname}|${salt}`, "halloween");
  const full = intensity === "full";
  const subtle = intensity === "subtle";
  // Alle Zufallszahlen werden immer gezogen - die Stärke schaltet nur ab, damit „dezent“ dieselbe Seite zeigt, nur ruhiger.
  const corner = rng() < 0.7 ? "tl" : "tr";
  const web = { corner, factor: between(rng, 0.85, 1.15), seed: rng(), build: rng() < 0.7 && !subtle, windBase: between(rng, 0.4, 0.9) };
  const secondWeb = rng() < 0.35 ? { corner: corner === "tl" ? "tr" : "tl", factor: between(rng, 0.4, 0.55), seed: rng(), build: false, windBase: 0.3 } : null;
  const spider = { side: corner === "tl" ? "right" : "left", offset: Math.round(between(rng, 2, 9)), period: between(rng, 45, 80), delay: between(rng, 25, 40), size: between(rng, 22, 30), drop: between(rng, 110, 200) };
  const spiders = subtle ? [] : [spider];
  const crawlerRoll = rng();
  const crawlerSpec = { every: between(rng, 150, 320), first: between(rng, 40, 90), size: between(rng, 24, 32), duration: between(rng, 16, 26) };
  const crawler = !subtle && (full || crawlerRoll < 0.4) ? crawlerSpec : null;
  // Die Abseil-Spinne kommt auf jeder Seite - nur die Seite, das Tempo und der Start wechseln.
  const rappelSpec = { side: pick(rng, ["left", "right"]), size: Math.round(between(rng, 22, 28)), speed: between(rng, 28, 44), first: between(rng, 5, 12), rest: between(rng, 40, 90) };
  const rappel = subtle ? null : rappelSpec;
  const batRoll = Math.floor(rng() * 3);
  const hangingBats = subtle ? 0 : full ? 2 + batRoll : 1 + batRoll;
  const graves = rng() < 0.6 ? Array.from({ length: 2 + Math.floor(rng() * 3) }, (_, index) => ({ x: 0.08 + index * 0.16 + rng() * 0.09, size: Math.round(between(rng, 20, 28)), tilt: between(rng, -7, 7) })) : [];
  const cat = rng() < 0.45 ? { size: Math.round(between(rng, 60, 76)), x: Math.round(between(rng, 40, 200)) } : null;
  const moonRoll = rng();
  const moon = !subtle && moonRoll < 0.85 ? { side: corner === "tl" ? "right" : "left" } : null;
  const footerPumpkins = [{ face: pick(rng, FACES), size: Math.round(between(rng, 46, 60)) }];
  if (rng() < 0.5) footerPumpkins.push({ face: pick(rng, FACES), size: Math.round(between(rng, 34, 44)), slow: true });
  const flock = full ? [5, 8] : [3, 5];
  return { web, secondWeb, spiders, crawler, rappel, hangingBats, graves, cat, moon, footerPumpkins, flock, lanternFace: pick(rng, FACES), night: false };
}

function useLayout(season) {
  const location = useLocation();
  return useMemo(() => ({ ...pageLayout(location.pathname, season.effective), night: Boolean(season.data?.night) }), [location.pathname, season.effective, season.data?.night]);
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

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

/** Scrollstand als CSS-Variable (Mond-Parallaxe) und ein Ereignis je Seitenwechsel (Fledermäuse). */
export function useScrollEffects(active) {
  const location = useLocation();
  useEffect(() => {
    if (!active || typeof window === "undefined") return undefined;
    const root = document.documentElement;
    const onScroll = () => root.style.setProperty("--season-scroll", `${Math.round(window.scrollY)}px`);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      root.style.removeProperty("--season-scroll");
    };
  }, [active]);
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.dispatchEvent(new CustomEvent("tls:season-page", { detail: { pathname: location.pathname } }));
    } catch {
      // ohne CustomEvent kein Start beim Seitenwechsel - der Zeitplan bleibt.
    }
  }, [location.pathname]);
}

/** Das fertige Netz als SVG - für „dezent“ und „Bewegung reduzieren“, ohne Physik, ganz im Bild. */
export function StaticWeb({ web, width }) {
  const plan = useMemo(() => buildPlan(web.seed), [web.seed]);
  const radius = webRadius(width, web.factor);
  const mirror = web.corner === "tr";
  const lines = useMemo(() => staticLines(plan, radius, mirror), [plan, radius, mirror]);
  const w = EXTENT.x * radius;
  const h = EXTENT.y * radius;
  return (
    <svg className={`tls-web tls-web--${web.corner}`} width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden="true" data-testid="halloween-web-static">
      {lines.map((line, index) => (
        <line key={index} x1={line.x1} y1={line.y1} x2={line.x2} y2={line.y2} stroke={line.kind === "spiral" ? "rgba(170, 225, 240, 0.4)" : "rgba(170, 225, 240, 0.58)"} strokeWidth={line.kind === "spiral" ? 0.65 : 0.9} strokeLinecap="round" />
      ))}
    </svg>
  );
}

/** Die Abseil-Spinne (#663): seilt sich am Rand bis zum Fußzeilen-Strich ab, lässt los, läuft weg; der Faden schwingt und reißt ab. */
export function RappelSpider({ spec, active }) {
  const [state, setState] = useState(null);
  useEffect(() => {
    if (!spec || !active || typeof window === "undefined") return undefined;
    let current = createRappel(spec);
    let last = performance.now();
    let acc = 0;
    let frame = 0;
    setState(current);
    const env = () => {
      const line = document.querySelector("footer [data-season-line]");
      const floorY = line ? line.getBoundingClientRect().top + window.scrollY : Math.max(400, document.documentElement.scrollHeight - 120);
      return { floorY, width: window.innerWidth };
    };
    const tick = () => {
      const now = performance.now();
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      const next = advanceRappel(current, dt, env());
      acc += dt;
      if (next.phase !== current.phase || acc >= 0.04) {
        acc = 0;
        setState(next);
      }
      current = next;
      frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [spec, active]);
  if (!spec || !active || !state || typeof document === "undefined") return null;
  const view = rappelView(state);
  if (!view.thread) return null;
  const classes = ["tls-rappel", `tls-rappel--${state.side}`, view.swaying ? "tls-rappel--sway" : "", view.detaching ? "tls-rappel--detach" : ""].filter(Boolean).join(" ");
  return createPortal(
    <div className={classes} style={{ height: `${Math.round(state.y)}px` }} aria-hidden="true" data-testid="halloween-rappel" data-phase={state.phase}>
      {view.spiderOnThread && <Spider size={state.size} thread={false} className="tls-rappel__spider" />}
      {view.running && <Spider size={state.size} thread={false} className="tls-rappel__runner" style={{ transform: `translate(${state.x.toFixed(0)}px, 0) rotate(${state.runDir > 0 ? 90 : -90}deg)` }} />}
      {!view.spiderOnThread && !view.running && <span className="tls-rappel__end" />}
    </div>,
    document.body,
  );
}

/** Die Spinne am Faden hängt am oberen Rand der Seite (nicht des Fensters): wer scrollt, lässt sie oben zurück. */
function DropSpiders({ spiders }) {
  if (!spiders.length || typeof document === "undefined") return null;
  return createPortal(
    <div className="tls-spiders" aria-hidden="true" data-testid="halloween-spiders">
      {spiders.map((spider) => (
        <Spider key={spider.side} className={`tls-spider--drop tls-spider--${spider.side}`} size={spider.size} style={{ "--spider-offset": `${spider.offset}vw`, "--spider-period": `${spider.period}s`, "--spider-delay": `${spider.delay}s`, "--spider-drop": `${spider.drop}px` }} data-testid={`halloween-spider-${spider.side}`} />
      ))}
    </div>,
    document.body,
  );
}

export function Corners({ season }) {
  const layout = useLayout(season);
  const { reducedMotion } = useReducedMotionFlag();
  const moving = season.effective !== "subtle" && !reducedMotion;
  const crawling = useRecurring(layout.crawler, moving);
  const width = useViewportWidth();
  useScrollEffects(moving);
  return (
    <>
      {!moving && <StaticWeb web={layout.web} width={width} />}
      {!moving && layout.secondWeb && <StaticWeb web={layout.secondWeb} width={width} />}
      {moving && <DropSpiders spiders={layout.spiders} />}
      {moving && crawling && layout.crawler && (
        <Spider className="tls-crawler" size={layout.crawler.size} thread={false} style={{ "--crawl-duration": `${layout.crawler.duration}s` }} data-testid="halloween-crawler" />
      )}
      <RappelSpider spec={layout.rappel} active={moving} />
      <HangingBats count={moving ? layout.hangingBats : 0} seed={layout.web.seed} salt={LOAD_SALT} />
    </>
  );
}

/** „Bewegung reduzieren“ des Systems - ohne den Kontext zu brauchen (Tests rendern die Ecken allein). */
function useReducedMotionFlag() {
  const [reducedMotion, setReducedMotion] = useState(() => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const onChange = () => setReducedMotion(query.matches);
    query.addEventListener?.("change", onChange);
    return () => query.removeEventListener?.("change", onChange);
  }, []);
  return { reducedMotion };
}

export function Backdrop({ season }) {
  const layout = useLayout(season);
  if (!layout.moon) return null;
  return <Moon className={`tls-moon--${layout.moon.side}`} />;
}

export function Footer({ season }) {
  const layout = useLayout(season);
  const moving = season.effective !== "subtle";
  return (
    <>
      {layout.cat && <CatOnEdge size={layout.cat.size} startX={layout.cat.x} moving={moving} />}
      {moving && <Graveyard graves={layout.graves} salt={LOAD_SALT} />}
      <div className="tls-footer-pumpkins" data-testid="halloween-pumpkins">
        {layout.footerPumpkins.map((pumpkin, index) => <Pumpkin key={index} size={pumpkin.size} face={pumpkin.face} slow={pumpkin.slow} />)}
      </div>
    </>
  );
}

export const CAT_WALK_SPEED = 55;

/** Wohin die Katze beim Klick läuft: ein anderes Stück des Strichs, mindestens 120 px weit, nie über die Kürbisse rechts. */
export function catTarget(currentX, width, rng = Math.random) {
  const min = 24;
  const max = Math.max(min + 160, width - 220);
  let x = currentX;
  for (let attempt = 0; attempt < 8 && Math.abs(x - currentX) < 120; attempt += 1) x = Math.round(min + rng() * (max - min));
  if (Math.abs(x - currentX) < 120) x = currentX > (min + max) / 2 ? min : max;
  return x;
}

/** Die Katze auf dem Strich über dem Impressum: Kopf und Pupillen folgen dem Zeiger; ein Klick lässt sie ein Stück weitertrotten. */
function CatOnEdge({ size, startX = 40, moving }) {
  const ref = useRef(null);
  const timer = useRef(0);
  const [x, setX] = useState(startX);
  const [walk, setWalk] = useState(null);
  // Hockt auf dem Strich über dem Impressum - wie die Gräber; ohne Strich auf der Oberkante des Footers.
  const lineTop = useFooterLineTop([size]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  useEffect(() => {
    if (!moving || typeof window === "undefined") return undefined;
    let frame = 0;
    const onMove = (event) => {
      if (frame || !ref.current) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const box = ref.current?.getBoundingClientRect();
        if (!box) return;
        const offset = eyeOffset({ x: event.clientX, y: event.clientY }, { x: box.left + box.width * 0.4, y: box.top + box.height * 0.4 }, 1.6);
        ref.current.style.setProperty("--eye-x", `${offset.x.toFixed(2)}px`);
        ref.current.style.setProperty("--head-tilt", `${(offset.x * 2.5).toFixed(2)}deg`);
      });
    };
    window.addEventListener("mousemove", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [moving]);
  const onClick = () => {
    if (!moving || walk) return;
    const width = ref.current?.parentElement?.clientWidth || (typeof window !== "undefined" ? window.innerWidth : 1280);
    const target = catTarget(x, width);
    const seconds = Math.abs(target - x) / CAT_WALK_SPEED;
    setWalk({ to: target, facing: target < x ? 1 : -1, seconds });
    setX(target);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setWalk(null), seconds * 1000 + 100);
  };
  const classes = ["tls-footer-cat", lineTop === null ? "" : "tls-footer-cat--line", walk ? "tls-footer-cat--walk" : "", (walk ? walk.facing : 1) < 0 ? "tls-footer-cat--flip" : ""].filter(Boolean).join(" ");
  const style = { left: `${x}px`, "--cat-seconds": walk ? `${walk.seconds.toFixed(2)}s` : "0s" };
  if (lineTop !== null) style.top = `${lineTop}px`;
  return (
    <div ref={ref} className={classes} style={style} onClick={onClick} role="presentation" data-testid="halloween-cat" data-walking={walk ? "1" : "0"}>
      {walk ? <CatWalking size={size} /> : <Cat size={size} />}
    </div>
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

/** Wo das Fenster gerade auf der Seite liegt - für Bahnen in Seitenkoordinaten. */
function pageView(size) {
  if (typeof window === "undefined") return { scrollY: 0, pageHeight: size.height };
  return { scrollY: window.scrollY || 0, pageHeight: Math.max(size.height, document.documentElement?.scrollHeight || 0) };
}

/** Die Ebenen für den gemeinsamen Canvas-Loop: das lebende Netz (eins oder zwei), Fledermäuse, Schwaden. */
export function skyLayers({ season, reducedMotion, weather = null }) {
  if (reducedMotion || season.effective === "subtle") return [];
  const night = Boolean(season.data?.night);
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const rng = pageRng(`${pathname}|${LOAD_SALT}`, "bats");
  const layout = pageLayout(pathname, season.effective);
  const layers = [createWebLayer({ ...layout.web, weather })];
  if (layout.secondWeb) layers.push(createWebLayer({ ...layout.secondWeb, weather }));
  const state = { flock: null, wait: 6, lastPath: pathname, pageArmed: true, wisp: null, wispWait: nextWispDelay(night, rng) };
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
  layers.push({
    key: "halloween-bats",
    draw(ctx, dt, size) {
      if (!state.flock) {
        state.wait -= dt;
        if (state.wait > 0) return;
        state.flock = createFlock(size, layout.flock, rng, pageView(size));
        dt = Math.max(0, -state.wait);
        state.wait = 0;
      }
      // Bahnen liegen in Seitenkoordinaten: um den Scrollstand versetzt zeichnen, außerhalb des Fensters nur rechnen.
      const scrollY = typeof window !== "undefined" ? window.scrollY || 0 : 0;
      advanceFlock(state.flock, dt).forEach((bat) => {
        const y = bat.y - scrollY;
        if (y > -60 && y < size.height + 60) drawBat(ctx, { ...bat, y });
      });
      if (state.flock.done) {
        state.flock = null;
        state.wait = nextFlightDelay(night, rng);
      }
    },
    dispose() {
      if (typeof window !== "undefined") window.removeEventListener("tls:season-page", onPage);
    },
  });
  layers.push({
    key: "halloween-wisps",
    draw(ctx, dt, size) {
      if (!state.wisp) {
        state.wispWait -= dt;
        if (state.wispWait > 0) return;
        state.wisp = createWisp(size, rng);
      }
      drawWisp(ctx, advanceWisp(state.wisp, dt, size));
      if (state.wisp.done) {
        state.wisp = null;
        state.wispWait = nextWispDelay(night, rng);
      }
    },
  });
  return layers;
}

export const season = { key: "halloween", accent: ACCENT, Corners, Backdrop, Footer, Widget, skyLayers };
