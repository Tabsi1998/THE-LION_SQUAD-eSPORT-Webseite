import { useEffect, useId, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { TEXT_LIKE } from "../anchors";
import { blocksPoint } from "../glyphs";
import { hashString, seasonYear } from "../rng";
import { readPreviewToken } from "../preview";
import { markToastShown, toastShownToday } from "../SeasonStage";
import { openSpot } from "../space";
import { confettiWind } from "./confetti";
import { HEAD_FALLBACK, headTop, streamerPath, streamerPlan } from "./geometry";
import { createConfettiLayer, requestBurst } from "./layer";
import "./carnival.css";

// Fasching (Jahreszeiten III S12 #643; F1–F3 #745–#747): ein Tag im Jahr, der Faschingsdienstag. Beim ersten Aufruf
// des Tages regnet es Konfetti mit eigener Physik, Luftschlangen entfalten sich am oberen Rand der Seite und schwingen
// danach leise, der Löwe trägt einen Partyhut - im Kopf der Seite und auf der Startseite der große Löwe. Antippen des
// Huts lässt ihn wippen und wirft eine Handvoll Konfetti (höchstens alle zehn Sekunden, ohne Erfolge daran). Dann ist
// Ruhe. „dezent“ und „Bewegung reduzieren“: kein Konfetti, die Luftschlangen hängen still, der Hut bleibt.

export const RAIN_KEY = "tls-carnival-rain";
export const UNFOLD_KEY = "tls-carnival-unfold";
export const GREETING_KEY = "carnival-greeting";
export const HAT_COOLDOWN_MS = 10000;
export const WIGGLE_MS = 700;
/** So viel Luft bleibt zwischen dem Ende einer Luftschlange und dem, was darunter steht. */
export const STREAMER_GAP = 14;
const STREAMER_MIN = 40;
const NARROW_PX = 640;
/** Ab so viel Rand neben dem Inhalt hängen die Luftschlangen am Inhalt statt am Fensterrand. */
const WIDE_MARGIN_PX = 140;

/**
 * Wo die Luftschlangen einer Seite hängen: am Fensterrand - auf breiten Schirmen, wo der Inhalt mit viel Rand in der
 * Mitte steht, außen an seinen Kanten (die Spalte der Kopfzeile), damit sie zum Inhalt gehören statt verloren am Rand.
 */
export function streamerX(streamer, width, column = null) {
  const wide = column && column.left >= WIDE_MARGIN_PX;
  if (streamer.side === "left") return Math.round(wide ? column.left - streamer.offset - 24 : streamer.offset);
  return Math.round(wide ? column.right + streamer.offset : width - streamer.offset - 24);
}

/** Wie weit eine Luftschlange in der Höhe `y` seitlich ausschlägt: Kräuselung, Strichbreite, Schwingen. */
export function streamerReach(streamer, y) {
  return streamer.curl * (0.35 + 0.65 * Math.min(1, y / streamer.length)) + 3 + y * 0.05;
}

/**
 * Wie lang eine Luftschlange hängen darf: so weit, wie über ihre ganze Breite nichts Lesbares im Weg ist, mit Luft
 * darunter; `free(x, y)` sagt, ob ein Punkt (Fensterkoordinaten) frei ist. 0, wenn es für eine Luftschlange nicht reicht.
 */
export function streamerLength(streamer, x, top, free) {
  const center = x + 12;
  for (let y = 4; y <= streamer.length + STREAMER_GAP; y += 6) {
    const reach = streamerReach(streamer, Math.min(y, streamer.length));
    if (![center - reach, center, center + reach].every((px) => free(px, top + y))) {
      const length = y - STREAMER_GAP;
      return length >= STREAMER_MIN ? Math.min(streamer.length, length) : 0;
    }
  }
  return streamer.length;
}

/** Frei für eine Luftschlange - die gemeinsame Probe für Deko an Kanten (space.js). */
export { openSpot };

/**
 * Frei für den großen Hut: keine Schrift (mit ihrem ganzen Kasten), kein Bild, kein Bedienelement - die Hüte selbst
 * und der Löwe, auf dem er sitzt, zählen nicht.
 */
export function hatRoom(doc, x, y, anchor = null) {
  const hits = typeof doc.elementsFromPoint === "function" ? doc.elementsFromPoint(x, y) : [];
  return !hits.some((el) => {
    if (el.closest(".tls-party-hat, .tls-party-hat-page, .tls-streamers")) return false;
    if (anchor && anchor.contains(el)) return false;
    return el.matches(TEXT_LIKE) || blocksPoint(el, x, y);
  });
}

/**
 * Wo im Hut nachgesehen wird (Anteile von Breite und Höhe): der ganze Kasten, nicht nur der Kegel - der Knopf fängt
 * dort Klicks ab -, mit etwas Rand für die Neigung; dazu Spitze, Schultern und Krempe.
 */
export const HAT_PROBES = [[-0.06, 0], [0.5, 0], [1.06, 0], [-0.06, 0.5], [1.06, 0.5], [0.3, 0.3], [0.7, 0.3], [0.15, 0.62], [0.85, 0.62]];
/** Erst kleiner, dann tiefer in die Mähne: so groß wie möglich, aber nie in die Schrift darüber. */
export const HERO_HAT_SHARES = [0.2, 0.17, 0.14];
export const HERO_HAT_SINKS = [0, 0.15, 0.3];

/** Der Platz des großen Huts: der erste aus Größe und Tiefe, über dem nichts liegt - sonst keiner. */
export function heroHatSpot(rect, head, free) {
  for (const share of HERO_HAT_SHARES) {
    const size = Math.round(rect.width * share);
    for (const sink of HERO_HAT_SINKS) {
      const at = hatSpot(rect, head, size);
      const top = Math.round(at.top + sink * size);
      if (HAT_PROBES.every(([px, py]) => free(at.left + px * size, top + py * size * 1.3))) return { left: at.left, top, size };
    }
  }
  return null;
}

function localDay(now = new Date()) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Einmal am Tag je Gerät (Regen, Entfalten) - in der Vorschau jedes Mal und ohne den echten Tag zu verbrauchen. */
export function firstTimeToday(key, storage = typeof window === "undefined" ? null : window.localStorage, now = new Date()) {
  if (readPreviewToken()) return true;
  try {
    if (storage?.getItem(key) === localDay(now)) return false;
    storage?.setItem(key, localDay(now));
    return true;
  } catch {
    return true;
  }
}

export function yearOf(season) {
  return seasonYear({ key: "carnival", starts_at: season?.starts_at || "" });
}

/** Die Konfetti-Ebene: Regen nur beim ersten Aufruf des Tages; danach nimmt sie nur noch Explosionen des Huts auf. */
export function skyLayers({ season, budget = 0, reducedMotion = false, weather = null }) {
  if (reducedMotion || season.effective === "subtle" || !budget) return [];
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const rain = firstTimeToday(RAIN_KEY);
  return [createConfettiLayer({ budget, effective: season.effective, seed: hashString(`${localDay()}:${pathname}`), rain, wind: () => confettiWind(weather) })];
}

/** Der Partyhut - kegelförmig, gestreift, mit Bommel und Gummiband; Vereinsfarben. */
export function PartyHatArt({ size = 24 }) {
  // Je Hut eine eigene Kennung: zwei Hüte auf einer Seite dürfen sich den Zuschnitt nicht teilen.
  const cone = `tls-hat-cone-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  return (
    <svg className="tls-party-hat__svg" width={size} height={size * 1.3} viewBox="0 0 40 52" aria-hidden="true">
      <defs>
        <clipPath id={cone}><path d="M20 6 L35 45 Q20 50 5 45 Z" /></clipPath>
      </defs>
      <path d="M20 6 L35 45 Q20 50 5 45 Z" fill="#29B6E8" />
      <g clipPath={`url(#${cone})`}>
        <path d="M2 30 L38 14 M2 42 L38 26 M2 54 L38 38" stroke="#FFD700" strokeWidth="4.2" />
        <circle cx="17" cy="23" r="1.6" fill="#ff4fa3" />
        <circle cx="25" cy="34" r="1.6" fill="#ffffff" />
        <circle cx="13" cy="38" r="1.4" fill="#ff4fa3" />
      </g>
      <path d="M5 45 Q20 50 35 45" stroke="#c9a800" strokeWidth="2.4" fill="none" strokeLinecap="round" />
      <circle cx="20" cy="6" r="4.6" fill="#ff4fa3" />
      <path d="M17 2.6 l-1.6 -2 M20 1.6 v-1.6 M23 2.6 l1.6 -2" stroke="#ff9ccb" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Ein Hut, der sich antippen lässt: wippt und wirft Konfetti - höchstens alle zehn Sekunden. Bei „dezent“ und
 * „Bewegung reduzieren“ ist er nur ein Bild: kein Knopf, der nichts tut.
 */
function Hat({ style, size, moving, testId, className = "" }) {
  const ref = useRef(null);
  const last = useRef(0);
  const [wiggle, setWiggle] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!moving) {
    return (
      <span className={`tls-party-hat tls-party-hat--still ${className}`} style={style} aria-hidden="true" data-testid={testId}>
        <PartyHatArt size={size} />
      </span>
    );
  }
  const onClick = () => {
    const now = Date.now();
    if (now - last.current < HAT_COOLDOWN_MS) return;
    last.current = now;
    setWiggle(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setWiggle(false), WIGGLE_MS);
    const box = ref.current?.getBoundingClientRect();
    if (box) requestBurst({ x: box.left + box.width / 2, y: box.top + box.height * 0.3 });
  };
  return (
    <button ref={ref} type="button" className={`tls-party-hat ${className}${wiggle ? " tls-party-hat--wiggle" : ""}`} style={style} onClick={onClick} aria-label="Partyhut – Konfetti werfen" title="Konfetti!" data-testid={testId}>
      <PartyHatArt size={size} />
    </button>
  );
}

/** Wo der Hut auf einem Bild sitzt (Fensterkoordinaten): auf dem Scheitel des Löwen, etwas eingesunken. */
export function hatSpot(rect, head, size, minTop = -Infinity) {
  return { left: Math.round(rect.left + head.x * rect.width - size / 2), top: Math.round(Math.max(minTop, rect.top + head.y * rect.height - size * 1.15)) };
}

/** Wartet, bis ein Bild geladen ist, und misst dann - auch nach neuer Fenstergröße. */
function useImageSpot(selector, measure, deps) {
  const [spot, setSpot] = useState(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let image = null;
    const run = () => {
      image = document.querySelector(selector);
      if (!image || !image.complete || !(image.naturalWidth > 0)) {
        setSpot(null);
        return;
      }
      setSpot(measure(image));
    };
    run();
    const retry = window.setTimeout(run, 600);
    image?.addEventListener?.("load", run);
    window.addEventListener("resize", run);
    return () => {
      window.clearTimeout(retry);
      image?.removeEventListener?.("load", run);
      window.removeEventListener("resize", run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return spot;
}

/** Der Hut auf dem Löwen im Kopf der Seite (die Kopfzeile klebt oben - der Hut darum fest am Fenster). */
function HeaderHat({ moving }) {
  const spot = useImageSpot("header [data-testid='tls-logo']", (image) => {
    const rect = image.getBoundingClientRect();
    if (rect.width < 20) return null;
    const size = Math.max(14, Math.round(rect.height * 0.46));
    // Im Kopf ist über dem Löwen kaum Platz: der Hut bleibt ganz im Fenster und sitzt dafür etwas tiefer.
    return { ...hatSpot(rect, headTop(image, "wordmark") || HEAD_FALLBACK.wordmark, size, 2), size };
  }, []);
  if (!spot) return null;
  return <Hat style={{ position: "fixed", left: `${spot.left}px`, top: `${spot.top}px` }} size={spot.size} moving={moving} testId="carnival-hat" className="tls-party-hat--header" />;
}

/** Der Hut auf dem großen Löwen der Startseite - gehört zur Seite und scrollt mit. */
function HeroHat({ moving }) {
  const location = useLocation();
  const spot = useImageSpot("[data-season-anchor='lion'] img", (image) => {
    const rect = image.getBoundingClientRect();
    if (rect.width < 80) return null;
    const anchor = image.closest("[data-season-anchor='lion']");
    const at = heroHatSpot(rect, headTop(image, "mascot") || HEAD_FALLBACK.mascot, (x, y) => hatRoom(document, x, y, anchor));
    return at ? { left: at.left + (window.scrollX || 0), top: at.top + (window.scrollY || 0), size: at.size } : null;
  }, [location.pathname]);
  if (!spot || typeof document === "undefined") return null;
  return createPortal(
    <div className="tls-party-hat-page" style={{ left: `${spot.left}px`, top: `${spot.top}px` }}>
      <Hat size={spot.size} moving={moving} testId="carnival-hero-hat" className="tls-party-hat--hero" />
    </div>,
    document.body,
  );
}

/**
 * Luftschlangen am oberen Rand des Inhalts (unter der Kopfzeile, Seitenkoordinaten - sie scrollen mit): links und
 * rechts, so lang, wie darunter nichts Lesbares hängt; beim ersten Aufruf des Tages entfalten sie sich, danach
 * schwingen sie leise. Ohne Bewegung hängen sie still.
 */
function Streamers({ season, moving }) {
  const location = useLocation();
  const plan = useMemo(() => streamerPlan(yearOf(season), location.pathname), [season, location.pathname]);
  const [placed, setPlaced] = useState([]);
  const [unfold] = useState(() => moving && firstTimeToday(UNFOLD_KEY));
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    const measure = () => {
      const header = document.querySelector("header");
      const viewTop = header ? header.getBoundingClientRect().bottom : 0;
      const column = header?.firstElementChild?.getBoundingClientRect() || null;
      // Ohne Scrollbalken gemessen: was über die Breite des Inhalts hinausragt, ließe die Seite seitlich scrollen.
      const width = document.documentElement.clientWidth || window.innerWidth;
      const next = [];
      for (const streamer of plan) {
        // Auf dem Handy eine je Seite - der Rand ist dort schmal.
        if (width < NARROW_PX && streamer.index > 0) continue;
        const x = streamerX(streamer, width, column);
        const length = streamerLength(streamer, x, viewTop, (px, py) => openSpot(document, px, py, width));
        if (length) next.push({ ...streamer, x, top: viewTop + (window.scrollY || 0), length });
      }
      setPlaced(next);
    };
    const timer = window.setTimeout(measure, 400);
    window.addEventListener("resize", measure);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener("resize", measure);
    };
  }, [plan]);
  if (!placed.length || typeof document === "undefined") return null;
  return createPortal(
    <div className="tls-streamers" aria-hidden="true" data-testid="carnival-streamers">
      {placed.map((streamer) => {
        const d = streamerPath(streamer);
        return (
          <svg
            key={`${streamer.side}:${streamer.index}`}
            className={`tls-streamer${moving ? " tls-streamer--sway" : ""}${unfold ? " tls-streamer--unfold" : ""}`}
            style={{ left: `${streamer.x}px`, top: `${streamer.top}px`, height: `${streamer.length + 4}px`, "--sway": `${streamer.sway}s`, "--length": streamer.length + 20, animationDelay: `${streamer.delay}ms` }}
            width="24"
            height={streamer.length + 4}
            viewBox={`0 0 24 ${streamer.length + 4}`}
            data-testid="carnival-streamer"
          >
            <path d={d} stroke={streamer.colors[0]} strokeWidth="4.6" fill="none" strokeLinecap="round" />
            <path d={d} stroke={streamer.colors[1]} strokeWidth="1.6" fill="none" strokeLinecap="round" strokeDasharray="5 8" />
          </svg>
        );
      })}
    </div>,
    document.body,
  );
}

/** Ecken und Kanten: Hüte und Luftschlangen. */
export function Corners({ season }) {
  const moving = season.effective !== "subtle";
  return (
    <>
      <HeaderHat moving={moving} />
      <HeroHat moving={moving} />
      <Streamers season={season} moving={moving} />
    </>
  );
}

/** Der Gruß einmal am Tag: eine Karte unten, „Schönen Fasching“ mit dem Text aus dem Admin. */
export function Toast({ season }) {
  const [open, setOpen] = useState(false);
  const greeting = season.texts?.greeting || "Schönen Fasching";
  useEffect(() => {
    if (typeof window === "undefined" || toastShownToday(GREETING_KEY)) return undefined;
    const show = window.setTimeout(() => {
      markToastShown(GREETING_KEY);
      setOpen(true);
    }, 1500);
    const hide = window.setTimeout(() => setOpen(false), 1500 + 10000);
    return () => {
      window.clearTimeout(show);
      window.clearTimeout(hide);
    };
  }, []);
  if (!open) return null;
  return (
    <div className="tls-season-toast tls-carnival-toast" role="status" data-testid="carnival-toast">
      <PartyHatArt size={22} />
      <span className="tls-carnival-toast__text">{greeting}</span>
      <button type="button" className="tls-carnival-toast__close" onClick={() => setOpen(false)} aria-label="Gruß schließen">×</button>
    </div>
  );
}

export const season = { key: "carnival", Corners, Toast, skyLayers };
