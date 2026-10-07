import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { seasonRng, seasonYear } from "../rng";
import { capabilities, scaleForViewport } from "../intensity";
import { getMotionScheduler } from "../motion";
import { markToastShown, toastShownToday } from "../SeasonStage";
import { Logo } from "../../components/tls/Logo";
import { CardChains } from "./CardChains";
import { LightChain } from "./LightChain";
import { MIN_WIDTH } from "./lights";
import "./christmas.css";

// Weihnachten (Jahreszeiten II S8, #639; X1, X2, X4 - #734, #735, #737): vom 24. bis 26. Dezember hängt eine
// Lichterkette mit echtem Draht und einzelnen Lämpchen unter der Kopfzeile und in der Fußzeile, die Seite wird
// wärmer (Lichtinseln hinter dem Inhalt, Schneehauben im warmen Licht, weniger große Bewegung), und einmal je Tag
// kommt ein Gruß als Karte des Vereins - Logo, Sternenlicht, Lichterfolge, Text aus dem Admin, je Tag ein anderer,
// Escape oder der Schließen-Knopf schließt, nach 14 s geht er von selbst. Am 6. Jänner ein letzter Gruß zum Abschied. Der Nikolausstiefel (X3) folgt eigens
// mit dem Sticker im Server. „Bewegung reduzieren“: alles still, der Gruß ohne Folge; „dezent“: Kette ohne Glimmen.

/** An Heiligabend und den Feiertagen bleibt ein Platz für große Bewegungen - Ruhe statt Schwarm (X2). */
export const HOLIDAY_SLOTS = 1;
export const TOAST_DELAY_MS = 1500;
export const TOAST_MS = 14000;
export const DAY_LABELS = { 24: "Heiligabend", 25: "Erster Weihnachtstag", 26: "Zweiter Weihnachtstag" };
/** Der Abschied am 6. Jänner trägt den Namen des Tages - der Text sagt schon „Danke fürs Mitfeiern“. */
export const FAREWELL_LABEL = "Heilige Drei Könige";

let yearSaltOverride = null;

/** Nur für Tests: ein festes Jahres-Salz. */
export function setYearSalt(value) {
  yearSaltOverride = value === null || value === undefined ? null : String(value);
}

/** Das Jahres-Salz: aus dem Beginn (Server), sonst aus der Uhr - der Abschied am 6. Jänner zählt zum alten Jahr. */
export function yearSaltFor(season, now = new Date()) {
  return yearSaltOverride ?? String(seasonYear({ key: "christmas", starts_at: season?.starts_at || "" }, now));
}

/** Was diese Seite bekommt: Kette an der Kopfzeile (ab 768 px, nicht still), Kette in der Fußzeile (Szene), Lichtinseln (Atmosphäre). */
export function christmasLayout(pathname = "/", effective = "normal", width = typeof window === "undefined" ? 1280 : window.innerWidth) {
  const caps = scaleForViewport(capabilities(pathname, effective, "christmas"), width);
  return { cls: caps.cls, chain: Boolean(caps.chain) && width >= MIN_WIDTH, footerChain: Boolean(caps.footerChain) && width >= MIN_WIDTH, glow: Boolean(caps.glow) };
}

/** Der Text des Grußes: je Tag ein eigener aus dem Admin (`greeting_25`, `greeting_26`), sonst der eine Gruß. */
export function greetingFor(season, now = new Date()) {
  const texts = season?.texts || {};
  if (season?.phase === "abschied") return { title: FAREWELL_LABEL, text: texts.farewell || "Danke fürs Mitfeiern – bis zum nächsten Jahr!", link: texts.farewell_link || "", day: 6 };
  const day = now.getMonth() === 11 && DAY_LABELS[now.getDate()] ? now.getDate() : 24;
  return { title: DAY_LABELS[day], text: texts[`greeting_${day}`] || texts.greeting || "Frohe Weihnachten wünscht THE LION SQUAD", link: "", day };
}

function useViewportWidth() {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onResize = () => setWidth(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return width;
}

/** Hintergrund (X2): warme Lichtinseln hinter dem Inhalt - nur an den Feiertagen, nie über Schrift. */
export function Backdrop({ season }) {
  const location = useLocation();
  const layout = christmasLayout(location.pathname, season.effective);
  if (season.phase !== "gruss" || !layout.glow || season.effective === "subtle") return null;
  return <div className="tls-season-backdrop tls-xmas-glow" aria-hidden="true" data-testid="christmas-glow" />;
}

/**
 * Kanten: die Lichterkette an Kopf- und Fußzeile und - seit Jahreszeiten IV (#1091) - kleine Ketten an einigen Karten,
 * die nachschwingen, wenn sich ihre Karte hebt; an den Feiertagen bleibt dem Planer nur ein Platz für große Bewegungen.
 */
export function Corners({ season }) {
  const location = useLocation();
  const width = useViewportWidth();
  const layout = christmasLayout(location.pathname, season.effective, width);
  const holiday = season.phase === "gruss";
  useEffect(() => {
    if (!holiday) return undefined;
    const scheduler = getMotionScheduler();
    if (typeof scheduler.setSlots !== "function") return undefined;
    const previous = scheduler.setSlots(HOLIDAY_SLOTS);
    return () => {
      scheduler.setSlots(previous);
    };
  }, [holiday]);
  if (season.phase !== "gruss") return null;
  return (
    <>
      {layout.chain ? <LightChain salt={yearSaltFor(season)} footer={layout.footerChain} width={width} /> : null}
      <CardChains season={season} salt={yearSaltFor(season)} />
    </>
  );
}

/** Sterne der Grußkarte: je Jahr anders, innerhalb des Jahres gleich. */
export function starField(year, count = 14) {
  const rng = seasonRng({ season: "christmas", year, route: "toast" }, "stars");
  return Array.from({ length: count }, (_, index) => ({ index, x: Math.round(rng() * 100), y: Math.round(rng() * 100), size: Math.round((1 + rng() * 1.6) * 10) / 10, delay: Math.round(rng() * 4 * 10) / 10 }));
}

/**
 * Der Gruß (S8, X4): einmal je Tag beim ersten Aufruf, 1,5 s nach dem Laden - Karte mit Logo, Sternenlicht, einer
 * Lichterfolge und dem Text des Tages; Escape, Klick oder nach 14 s schließt. `now` und `storageCheck` sind Test-Nähte.
 */
export function Toast({ season, now = null, force = false }) {
  const [open, setOpen] = useState(false);
  const timers = useRef([]);
  const key = `christmas-${season.phase || "gruss"}`;
  const greeting = useMemo(() => greetingFor(season, now || new Date()), [season, now]);
  const stars = useMemo(() => starField(yearSaltFor(season, now || new Date())), [season, now]);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    if (!force && toastShownToday(key, now || new Date())) return undefined;
    const show = window.setTimeout(() => {
      markToastShown(key, now || new Date());
      setOpen(true);
    }, TOAST_DELAY_MS);
    const hide = window.setTimeout(() => setOpen(false), TOAST_DELAY_MS + TOAST_MS);
    timers.current = [show, hide];
    return () => timers.current.forEach((handle) => window.clearTimeout(handle));
  }, [key, force, now]);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  const subtle = season.effective === "subtle";
  return (
    <div className={`tls-season-toast tls-xmas-toast${subtle ? " tls-xmas-toast--subtle" : ""}`} role="status" data-testid="christmas-toast" data-day={greeting.day}>
      <div className="tls-xmas-toast__stars" aria-hidden="true">
        {stars.map((star) => <span key={star.index} className="tls-xmas-toast__star" style={{ left: `${star.x}%`, top: `${star.y}%`, width: `${star.size}px`, height: `${star.size}px`, "--twinkle-delay": `${star.delay}s` }} />)}
      </div>
      <div className="tls-xmas-toast__lights" aria-hidden="true">
        {["blue", "warm", "gold", "warm", "blue", "red", "warm", "blue"].map((color, index) => <span key={index} className={`tls-xmas-toast__light tls-xmas-toast__light--${color}`} style={{ "--light-index": index }} />)}
      </div>
      <div className="tls-xmas-toast__body">
        <Logo variant="mascot" size="sm" asLink={false} className="tls-xmas-toast__logo" />
        <div>
          <div className="tls-xmas-toast__title">{greeting.title}</div>
          <p className="tls-xmas-toast__text">{greeting.text}</p>
          {greeting.link && <a className="tls-xmas-toast__link" href={greeting.link}>Zum Jahresrückblick</a>}
        </div>
        <button type="button" className="tls-xmas-toast__close" aria-label="Gruß schließen" onClick={() => setOpen(false)} data-testid="christmas-toast-close">×</button>
      </div>
    </div>
  );
}

export const season = { key: "christmas", Backdrop, Corners, Toast };
