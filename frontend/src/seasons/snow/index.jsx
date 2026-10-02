import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { moonPosition, skyPlacement } from "../astronomy";
import { DEFAULT_LOCATION } from "../MoonInSky";
import { seasonSeed, seasonYear } from "../rng";
import { capabilities, scaleForViewport } from "../intensity";
import { useSeason } from "../SeasonContext";
import { recordSignal } from "../signals";
import { skyLight } from "../skyLight";
import { createSnowLayer } from "./layer";
import { SnowCaps } from "./SnowCaps";
import { WinterSky } from "./WinterSky";
import "./snow.css";

// Schnee (Jahreszeiten II S7, #638; Advent & Winter W2 und W3, #728, #729): vom 1. Advent bis Dreikönig fällt
// Schnee über der Seite - drei Tiefen, Wind und Böen aus dem Wetter, echter Schneefall macht es dichter - und sammelt
// sich auf echten Kanten (Karten, Rahmen, Fußzeile) als Hauben, die mit der Stufe wachsen und bei Plusgraden tauen.
// Nachts bei „voll“ ein leiser Blauschein hinter dem Inhalt. Neben dem Logo eine Schneeflocke zum Fangen: fünfzig
// Klicks sind das Signal für den geheimen Erfolg „Schneekönig“. Reduced Motion und „dezent“: keine Flocken, die
// Hauben bleiben. Alles aus dem Jahres-Seed; die Seitenklasse (intensity.js, Saison `snow`) sagt, wie viel.
// Winterhimmel (W4 #730): hinter dem Inhalt Blauschein, Glühen, Sterne und Mond nach Sonnenzeiten und Wetter; die
// Hauben nehmen dasselbe Licht an - tags weiß, nachts kühl, im Abendglühen warm, unter dem Mond heller.

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
  return { cls: caps.cls, share: caps.flakes, caps: Boolean(caps.caps) && caps.capsMax > 0, capsMax: caps.capsMax, tint: Boolean(caps.tint), stars: Number(caps.stars) || 0, moon: Boolean(caps.moon), mobile: Boolean(caps.mobile) };
}

/** Die Ebene für den gemeinsamen Canvas-Loop: Flocken - nicht ohne Bewegung, nicht bei „dezent“, nicht ohne Budget. */
export function skyLayers({ season, budget = 0, reducedMotion = false, weather = null }) {
  if (reducedMotion || season.effective === "subtle" || !budget) return [];
  const pathname = typeof window !== "undefined" ? window.location.pathname : "/";
  const layout = snowLayout(pathname, season.effective);
  if (layout.share <= 0) return [];
  return [createSnowLayer({ budget, share: layout.share, seed: seasonSeed({ season: "snow", year: yearSaltFor(season), route: pathname }), weather, endsAt: season.ends_at || "" })];
}

/**
 * Die Uhr des Himmels nach der Serverzeit (eine Vorschau „zu dieser Zeit“ verschiebt sie): jede Minute neu - das Licht
 * ändert sich langsam. `now` nur für Tests.
 */
function useSkyClock(now) {
  const { serverOffset } = useSeason();
  const read = () => (now ? now() : Date.now() + (serverOffset || 0));
  const [at, setAt] = useState(read);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    setAt(read());
    const timer = window.setInterval(() => setAt(read()), 60000);
    return () => window.clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now, serverOffset]);
  return at;
}

/** Das Licht dieser Minute aus den Sonnenzeiten und dem Wetter (Server); ohne Wetter die Nacht der Saison. */
function useWinterLight(season, now) {
  const { weather } = useSeason();
  const at = useSkyClock(now);
  return skyLight({ now: at, sunrise: weather?.sunrise, sunset: weather?.sunset, code: weather?.code, night: season.data?.night });
}

/**
 * Hintergrund: der Winterhimmel, wo die Seite Atmosphäre erlaubt - immer hinter dem Inhalt. „dezent“ und „Bewegung
 * reduzieren“ (beides kommt als `subtle`): derselbe Himmel still, mit halb so vielen Sternen.
 */
export function Backdrop({ season, now }) {
  const location = useLocation();
  const { location: place } = useSeason();
  const width = useViewportWidth();
  const light = useWinterLight(season, now);
  const layout = snowLayout(location.pathname, season.effective, width);
  if (!layout.tint) return null;
  const still = season.effective === "subtle";
  return <WinterSky light={light} stars={still ? Math.round(layout.stars / 2) : layout.stars} moon={layout.moon} year={yearSaltFor(season)} moving={!still} location={place} />;
}

/** Wo der Mond gerade über den Hauben steht (0…1 der Fensterbreite) - null, wenn er unter dem Horizont ist. */
export function moonSide(place, at, width = typeof window === "undefined" ? 1280 : window.innerWidth) {
  const spot = place && Number.isFinite(Number(place.lat)) && Number.isFinite(Number(place.lon)) ? { lat: Number(place.lat), lon: Number(place.lon) } : DEFAULT_LOCATION;
  const position = moonPosition(new Date(at), spot.lat, spot.lon);
  if (position.altitude <= 0) return null;
  return skyPlacement(position, { width, height: 800 }).x / width;
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

/** Ecken und Kanten: die Hauben (nach Klasse und Fensterbreite; Handy keine) im Licht des Himmels. */
export function Corners({ season, now }) {
  const location = useLocation();
  const { weather, location: place } = useSeason();
  const width = useViewportWidth();
  const light = useWinterLight(season, now);
  const layout = snowLayout(location.pathname, season.effective, width);
  if (!layout.caps) return null;
  const moonX = light.night > 0.05 ? moonSide(place, now ? now() : Date.now(), width) : null;
  return <SnowCaps stage={Number(season.data?.snowcap_stage) || 1} tempC={weather && weather.temp_c !== undefined ? weather.temp_c : null} salt={yearSaltFor(season)} max={layout.capsMax} light={light} moonX={moonX} />;
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
