import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { between, pageRng, pick } from "../rng";
import { BatShape, Cobweb, Ghost, Graveyard, Lantern, Moon, Pumpkin, Spider, StringLantern } from "./art";
import { advanceFlock, createFlock, drawBat, nextFlightDelay } from "./bats";
import { recordSignal } from "../signals";
import "./halloween.css";

// Halloween (#635, #655): große Spinnweben mit Spinnen, die sich abseilen und ab und zu quer über den
// Bildschirm krabbeln, sichtbare Fledermausschwärme, hängende Fledermäuse an der Kopfzeile, Lichterketten,
// Friedhof und Mond in den Breitbild-Rändern, Nebel, geschnitzte Kürbisse am Footer, die Laterne neben
// dem Löwen. Jede Seite bekommt aus ihrer Adresse eine eigene Anordnung - stabil je Seite, anders je Seite.

export const ACCENT = "rgba(255, 140, 0, 0.45)";
export const SIGNAL_KEY = "halloween_pumpkin";
export const FACES = ["grin", "scared", "wicked"];

/** Zählt der Klick? Nur am 31. Oktober ab 18:00 (Ortszeit des Geräts, der Server prüft später selbst). */
export function pumpkinCounts(now = new Date()) {
  return now.getMonth() === 9 && now.getDate() === 31 && now.getHours() >= 18;
}

/** Was diese Seite bekommt - aus der Adresse berechnet: gleiche Seite, gleiches Bild; andere Seite, anderes Bild. */
export function pageLayout(pathname, intensity = "normal") {
  const rng = pageRng(pathname, "halloween");
  const full = intensity === "full";
  const subtle = intensity === "subtle";
  const webs = [
    { corner: "tl", scale: between(rng, 0.85, 1.2), rotate: between(rng, -5, 5), torn: rng() < 0.45 ? [pick(rng, [2, 4, 6])] : [] },
    { corner: "tr", scale: between(rng, 0.7, 1.1), rotate: between(rng, -5, 5), torn: rng() < 0.45 ? [pick(rng, [3, 5])] : [] },
  ];
  if (rng() < 0.75) webs.push({ corner: "bl", scale: between(rng, 0.55, 0.85), rotate: 0, torn: [], wide: true });
  if (rng() < 0.75) webs.push({ corner: "br", scale: between(rng, 0.55, 0.85), rotate: 0, torn: [], wide: true });
  const spiders = subtle ? [] : [{ side: "left", period: between(rng, 34, 60), delay: 5, size: between(rng, 54, 78), drop: between(rng, 120, 220) }];
  if (!subtle && (full || rng() < 0.6)) spiders.push({ side: "right", period: between(rng, 40, 70), delay: between(rng, 14, 30), size: between(rng, 46, 66), drop: between(rng, 90, 190) });
  const hangingBats = subtle ? [] : Array.from({ length: 1 + Math.floor(rng() * 2) }, () => ({ x: between(rng, 18, 82), size: between(rng, 44, 64), delay: between(rng, 0, 20), period: between(rng, 18, 40) }));
  const crawler = subtle ? null : { every: between(rng, 90, 240), first: between(rng, 20, 60), size: between(rng, 64, 96), edge: pick(rng, ["bottom", "bottom", "top"]), duration: between(rng, 14, 22) };
  const footerPumpkins = [
    { face: pick(rng, FACES), size: Math.round(between(rng, 60, 80)) },
    { face: pick(rng, FACES), size: Math.round(between(rng, 44, 58)), slow: true },
  ];
  if (rng() < 0.5) footerPumpkins.push({ face: pick(rng, FACES), size: Math.round(between(rng, 34, 46)) });
  const lanternCount = subtle ? 0 : 3 + Math.floor(rng() * 3);
  const rails = {
    lanterns: Array.from({ length: lanternCount }, () => ({ kind: rng() < 0.7 ? "pumpkin" : "ghost", delay: between(rng, 0, 4) })),
    graveyard: rng() < 0.85,
    moon: rng() < 0.9,
    moonSide: pick(rng, ["right", "right", "left"]),
  };
  const ghost = full && rng() < 0.75 ? { every: between(rng, 110, 220), first: between(rng, 25, 70), side: pick(rng, ["left", "right"]), y: between(rng, 18, 62) } : null;
  return { webs, spiders, hangingBats, crawler, footerPumpkins, rails, ghost, fog: full ? "dense" : subtle ? "none" : "light", vignette: full, lanternFace: pick(rng, FACES), night: false };
}

function useLayout(season) {
  const location = useLocation();
  return useMemo(() => ({ ...pageLayout(location.pathname, season.effective), night: Boolean(season.data?.night) }), [location.pathname, season.effective, season.data?.night]);
}

const CORNER_CLASS = { tl: "tls-web--tl", tr: "tls-web--tr", bl: "tls-web--bl", br: "tls-web--br" };

/** Ein Element, das nach einer Wartezeit immer wieder für `duration` Sekunden erscheint (Krabbler, Geist). */
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

export function Corners({ season }) {
  const layout = useLayout(season);
  const moving = season.effective !== "subtle";
  const crawling = useRecurring(layout.crawler, moving);
  const haunting = useRecurring(layout.ghost, moving);
  return (
    <>
      {layout.webs.map((web) => (
        <Cobweb key={web.corner} className={`${CORNER_CLASS[web.corner]} ${web.wide ? "tls-web--wide" : ""}`} torn={web.torn} style={{ "--web-scale": web.scale, "--web-rotate": `${web.rotate}deg` }} />
      ))}
      {layout.spiders.map((spider) => (
        <Spider key={spider.side} className={`tls-spider--${spider.side}`} size={spider.size} style={{ "--spider-period": `${spider.period}s`, "--spider-delay": `${spider.delay}s`, "--spider-drop": `${spider.drop}px` }} />
      ))}
      {layout.hangingBats.map((bat, index) => (
        <BatShape key={`hang-${index}`} className="tls-hanging-bat" size={bat.size} style={{ left: `${bat.x}%`, "--bat-delay": `${bat.delay}s`, "--bat-period": `${bat.period}s` }} />
      ))}
      {layout.rails.lanterns.length > 0 && ["left", "right"].map((side) => (
        <div key={side} className={`tls-rail tls-rail--${side}`} data-testid={`halloween-rail-${side}`}>
          <svg className="tls-rail__wire" viewBox="0 0 100 40" preserveAspectRatio="none" aria-hidden="true"><path d="M0 6 Q 25 34 50 10 T 100 8" stroke="rgba(255,255,255,0.35)" strokeWidth="1.2" fill="none" /></svg>
          {layout.rails.lanterns.map((lantern, index) => (
            <StringLantern key={index} kind={lantern.kind} style={{ left: `${10 + (index * 80) / Math.max(1, layout.rails.lanterns.length - 1)}%`, "--lantern-delay": `${lantern.delay}s` }} />
          ))}
          {layout.rails.graveyard && <Graveyard mirrored={side === "right"} className="tls-rail__graveyard" />}
        </div>
      ))}
      {crawling && layout.crawler && (
        <Spider className={`tls-crawler tls-crawler--${layout.crawler.edge}`} size={layout.crawler.size} style={{ "--crawl-duration": `${layout.crawler.duration}s` }} data-testid="halloween-crawler" />
      )}
      {haunting && layout.ghost && (
        <Ghost className={`tls-ghost--drift tls-ghost--${layout.ghost.side}`} style={{ top: `${layout.ghost.y}%` }} />
      )}
    </>
  );
}

export function Backdrop({ season }) {
  const layout = useLayout(season);
  const full = season.effective === "full";
  return (
    <>
      {layout.rails.moon && season.effective !== "subtle" && <Moon className={`tls-moon--${layout.rails.moonSide}`} />}
      {full && <div className="tls-vignette" aria-hidden="true" />}
      {layout.fog !== "none" && <div className={`tls-fog ${layout.fog === "dense" || layout.night ? "tls-fog--dense" : ""}`} aria-hidden="true" data-testid="halloween-fog" />}
    </>
  );
}

export function Footer({ season }) {
  const layout = useLayout(season);
  return (
    <div className="tls-footer-pumpkins" data-testid="halloween-pumpkins">
      {layout.footerPumpkins.map((pumpkin, index) => <Pumpkin key={index} size={pumpkin.size} face={pumpkin.face} slow={pumpkin.slow} />)}
      <svg className="tls-leaf" width="28" height="22" viewBox="0 0 28 22" aria-hidden="true"><path d="M2 20 q6 -18 24 -18 q-2 16 -18 18 q-2 -6 2 -10 q-6 3 -8 10 z" fill="#b5541c" /></svg>
    </div>
  );
}

export function Widget({ season }) {
  const layout = useLayout(season);
  const [open, setOpen] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const greeting = season.texts?.greeting || "Happy Halloween";
  const onClick = () => {
    setOpen(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setOpen(false), 4000);
    if (pumpkinCounts()) recordSignal(SIGNAL_KEY);
  };
  return (
    <span className="relative">
      <button type="button" onClick={onClick} className={`tls-lantern ${open ? "tls-lantern--open" : ""}`} aria-label={greeting} title={greeting} data-testid="halloween-lantern">
        <Lantern open={open} face={layout.lanternFace} />
      </button>
      {open && <span className="tls-lantern__note" role="status" data-testid="halloween-note">{greeting}</span>}
    </span>
  );
}

/** Die Fledermäuse als Ebene für den gemeinsamen Canvas-Loop - Saat aus der Seite, erster Flug nach drei Sekunden. */
export function skyLayers({ season, reducedMotion }) {
  if (reducedMotion || season.effective === "subtle") return [];
  const night = Boolean(season.data?.night);
  const rng = pageRng(typeof window !== "undefined" ? window.location.pathname : "/", "bats");
  const state = { flock: null, wait: 3, lastPath: "", scrollArmed: true };
  const onScroll = () => {
    const path = typeof window !== "undefined" ? window.location.pathname : "";
    if (!state.scrollArmed || path === state.lastPath) return;
    state.lastPath = path;
    state.scrollArmed = false;
    if (!state.flock) state.wait = Math.min(state.wait, 0.5);
    window.setTimeout(() => {
      state.scrollArmed = true;
    }, 45000);
  };
  if (typeof window !== "undefined") window.addEventListener("scroll", onScroll, { passive: true });
  return [{
    key: "halloween-bats",
    draw(ctx, dt, size) {
      if (!state.flock) {
        state.wait -= dt;
        if (state.wait > 0) return;
        // Der Schwarm startet in diesem Bild - nur die Zeit über der Wartezeit zählt schon als Flug.
        state.flock = createFlock(size, season.effective, rng);
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
      if (typeof window !== "undefined") window.removeEventListener("scroll", onScroll);
    },
  }];
}

export const season = { key: "halloween", accent: ACCENT, Corners, Backdrop, Footer, Widget, skyLayers };
