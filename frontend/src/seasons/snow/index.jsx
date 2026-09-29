import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { seasonSeed, seasonYear } from "../rng";
import { capabilities, scaleForViewport } from "../intensity";
import { useSeason } from "../SeasonContext";
import { recordSignal } from "../signals";
import { createSnowLayer } from "./layer";
import { SnowCaps } from "./SnowCaps";
import "./snow.css";

// Schnee (Jahreszeiten II S7, #638; Advent & Winter W2 und W3, #728, #729): vom 1. Advent bis Dreikönig fällt
// Schnee über der Seite - drei Tiefen, Wind und Böen aus dem Wetter, echter Schneefall macht es dichter - und sammelt
// sich auf echten Kanten (Karten, Rahmen, Fußzeile) als Hauben, die mit der Stufe wachsen und bei Plusgraden tauen.
// Nachts bei „voll“ ein leiser Blauschein hinter dem Inhalt. Neben dem Logo eine Schneeflocke zum Fangen: fünfzig
// Klicks sind das Signal für den geheimen Erfolg „Schneekönig“. Reduced Motion und „dezent“: keine Flocken, die
// Hauben bleiben. Alles aus dem Jahres-Seed; die Seitenklasse (intensity.js, Saison `snow`) sagt, wie viel.

export const SIGNAL_KEY = "snowflakes_clicked";
export const SNOW_KING_AT = 50;
export const CLICKS_KEY = "tls_snow_clicks";
export const BURST_MS = 700;

let yearSaltOverride = null;

/** Nur für Tests: ein festes Jahres-Salz. */
export function setYearSalt(value) {
  yearSaltOverride = value === null || value === undefined ? null : String(value);
}

/** Das Jahres-Salz (C4): aus dem Beginn der Saison (Server), sonst aus der Uhr - Schnee geht über Silvester und zählt zum Jahr des Beginns. */
export function yearSaltFor(season, now = new Date()) {
  return yearSaltOverride ?? String(seasonYear({ key: "snow", starts_at: season?.starts_at || "" }, now));
}

/** Was diese Seite bekommt: Anteil der Flocken, ob und wie viele Hauben, Blauschein - aus den Effektklassen (C5). */
export function snowLayout(pathname = "/", effective = "normal", width = typeof window === "undefined" ? 1280 : window.innerWidth) {
  const caps = scaleForViewport(capabilities(pathname, effective, "snow"), width);
  return { cls: caps.cls, share: caps.flakes, caps: Boolean(caps.caps) && caps.capsMax > 0, capsMax: caps.capsMax, tint: Boolean(caps.tint), mobile: Boolean(caps.mobile) };
}

/** Die Ebene für den gemeinsamen Canvas-Loop: Flocken - nicht ohne Bewegung, nicht bei „dezent“, nicht ohne Budget. */
export function skyLayers({ season, budget = 0, reducedMotion = false, weather = null }) {
  if (reducedMotion || season.effective === "subtle" || !budget) return [];
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const layout = snowLayout(pathname, season.effective);
  if (layout.share <= 0) return [];
  return [createSnowLayer({ budget, share: layout.share, seed: seasonSeed({ season: "snow", year: yearSaltFor(season), route: pathname }), weather, endsAt: season.ends_at || "" })];
}

/** Hintergrund: nachts bei „voll“ ein leiser Blauschein - nie über Schrift (liegt hinter dem Inhalt). */
export function Backdrop({ season }) {
  if (season.effective !== "full" || !season.data?.night) return null;
  return <div className="tls-season-backdrop tls-snow-tint" aria-hidden="true" data-testid="snow-tint" />;
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

/** Ecken und Kanten: die Hauben (nach Klasse und Fensterbreite; Handy keine). */
export function Corners({ season }) {
  const location = useLocation();
  const { weather } = useSeason();
  const width = useViewportWidth();
  const layout = snowLayout(location.pathname, season.effective, width);
  if (!layout.caps) return null;
  return <SnowCaps stage={Number(season.data?.snowcap_stage) || 1} tempC={weather && weather.temp_c !== undefined ? weather.temp_c : null} salt={yearSaltFor(season)} max={layout.capsMax} />;
}

function readClicks(storage) {
  try {
    const value = Number(storage && typeof storage.getItem === "function" ? storage.getItem(CLICKS_KEY) : 0);
    return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
  } catch {
    return 0;
  }
}

function writeClicks(storage, value) {
  try {
    if (storage && typeof storage.setItem === "function") storage.setItem(CLICKS_KEY, String(value));
  } catch {
    // ohne Speicher zählt nur diese Seite
  }
}

/** Zwölf Splitter, die beim Fangen auseinanderfliegen. */
const SHARDS = Array.from({ length: 12 }, (_, i) => {
  const angle = (i / 12) * Math.PI * 2;
  const distance = 14 + (i % 3) * 5;
  return { dx: `${(Math.cos(angle) * distance).toFixed(1)}px`, dy: `${(Math.sin(angle) * distance).toFixed(1)}px` };
});

/** Ein sechsstrahliger Kristall. */
export function Snowflake() {
  const arms = Array.from({ length: 6 }, (_, i) => (i / 6) * 360);
  return (
    <svg className="tls-snowflake__svg" viewBox="-14 -14 28 28" aria-hidden="true">
      {arms.map((angle) => (
        <g key={angle} transform={`rotate(${angle})`} stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" fill="none">
          <line x1="0" y1="0" x2="0" y2="-12" />
          <line x1="0" y1="-7" x2="-3.2" y2="-9.6" />
          <line x1="0" y1="-7" x2="3.2" y2="-9.6" />
          <line x1="0" y1="-4" x2="-2" y2="-5.6" />
          <line x1="0" y1="-4" x2="2" y2="-5.6" />
        </g>
      ))}
      <circle cx="0" cy="0" r="1.6" fill="currentColor" />
    </svg>
  );
}

/** Die Schneeflocke neben dem Logo: fangen (Klick) lässt sie in Splitter platzen und zählt - fünfzig ergeben den Schneekönig. */
export function Widget({ season, storage = typeof window === "undefined" ? null : window.localStorage }) {
  const [clicks, setClicks] = useState(() => readClicks(storage));
  const [burst, setBurst] = useState(false);
  const [note, setNote] = useState("");
  const burstTimer = useRef(0);
  const noteTimer = useRef(0);
  useEffect(() => () => {
    window.clearTimeout(burstTimer.current);
    window.clearTimeout(noteTimer.current);
  }, []);
  const onClick = () => {
    const next = clicks + 1;
    setClicks(next);
    writeClicks(storage, next);
    recordSignal(SIGNAL_KEY, { onceIf: false });
    if (season?.effective !== "subtle") {
      setBurst(false);
      window.clearTimeout(burstTimer.current);
      burstTimer.current = window.setTimeout(() => setBurst(false), BURST_MS);
      // Im nächsten Tick, damit die Animation bei jedem Klick neu startet.
      window.setTimeout(() => setBurst(true), 0);
    }
    if (next === SNOW_KING_AT) {
      setNote("Fünfzig Flocken gefangen – Schneekönig!");
      window.clearTimeout(noteTimer.current);
      noteTimer.current = window.setTimeout(() => setNote(""), 5000);
    }
  };
  const label = clicks >= SNOW_KING_AT ? `Schneeflocke – Schneekönig mit ${clicks} Flocken` : `Schneeflocke fangen – ${clicks} von ${SNOW_KING_AT}`;
  return (
    <span className="relative tls-snow-widget" data-testid="snow-widget" data-clicks={clicks}>
      <button type="button" onClick={onClick} className={`tls-snowflake${burst ? " tls-snowflake--burst" : ""}`} aria-label={label} title={label} data-testid="snow-flake">
        <Snowflake />
        <span className="tls-snowflake__burst" aria-hidden="true">
          {SHARDS.map((shard, index) => <span key={index} className="tls-snowflake__shard" style={{ "--dx": shard.dx, "--dy": shard.dy }} />)}
        </span>
      </button>
      {note && <span className="tls-snowflake__note" role="status" data-testid="snow-note">{note}</span>}
    </span>
  );
}

export const season = { key: "snow", Backdrop, Corners, Widget, skyLayers };
