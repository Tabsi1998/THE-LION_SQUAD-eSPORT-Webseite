import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { releaseMotion, requestMotion } from "../motion";
import { measureQuietZones, overlayZones, rectInQuiet, watchOverlays } from "../quiet";
import { hashString } from "../rng";
import { snowLightAt } from "../skyLight";
import { OVERHANG, capLevel, capPath, capThickness, measureCaps } from "./caps";
import { TRACK_MIN_RUN, TRACK_REST_MS, TRACK_STEP_MS, dentsAt, markTracks, trackSteps, tracksDuration, tracksToday } from "./tracks";

// Schneehauben (S7, #638; W3, #729): still auf den Oberkanten von Karten, Rahmen und der Fußzeile im Fenster - je
// Kante eine eigene Kontur und ein eigenes Wachstum aus dem Jahres-Seed, nur auf freien Stücken (nie über Abzeichen,
// Knöpfen, Schrift), mit der Stufe des Servers und dem Tauwetter des echten Wetters. Beim Scrollen kommen weitere
// Kanten dazu; unter geöffneten Dialogen und Menüs weicht eine Haube aus. Ohne Bewegung bleiben die Hauben - sie
// bewegen sich ohnehin nicht. Verschiebt kein Layout: liegt als eigene Ebene über der Kante. Im Licht des
// Winterhimmels (W4 #730): tags weiß, nachts kühl, im Glühen auf der Seite der Sonne warm, unter dem Mond heller.

const REFRESH_DELAYS = [400, 1500, 3500];
/** Wie hoch eine Haube mit Zapfen höchstens ist - für das Ausweichen unter Dialogen. */
const YIELD_HEIGHT = 18;

/** Liegt eine Haube unter einem geöffneten Dialog oder Menü? */
export function capYields(cap, zones) {
  const overlays = overlayZones(zones);
  if (!overlays.length) return false;
  return rectInQuiet({ left: cap.x, top: cap.y - YIELD_HEIGHT, right: cap.x + cap.width, bottom: cap.y + 6 }, overlays, { fixed: false, overlayOnly: true });
}

function sameCaps(a, b) {
  return a.length === b.length && a.every((cap, index) => {
    const other = b[index];
    return cap.key === other.key && cap.x === other.x && cap.y === other.y && cap.yield === other.yield && cap.runs.length === other.runs.length && cap.runs.every((run, n) => run.from === other.runs[n].from && run.to === other.runs[n].to);
  });
}

/** Das Licht des Tages, wenn der Himmel keines sagt: die Farben von früher (weiß, nach unten blauer). */
const DAYLIGHT = { night: 0, warmth: 0, side: 0.7, clouds: 0, stars: 0, moon: 0 };

/** Das längste freie Stück auf der Haube des Footers - dort läuft die Spur (mindestens TRACK_MIN_RUN breit). */
export function footerRun(caps) {
  let best = null;
  caps.forEach((cap) => {
    if (cap.kind !== "footer" || cap.yield) return;
    cap.runs.forEach((run, index) => {
      const width = run.to - run.from;
      if (width >= TRACK_MIN_RUN && (!best || width > best.width)) best = { cap, index, width };
    });
  });
  return best;
}

/**
 * Die Spur im Schnee (W5 #731): einmal am Tag je Gerät, wenn die Haube des Footers anderthalb Sekunden im Fenster
 * ist und das Bewegungsbudget Platz hat. Liefert die Dellen des Augenblicks für genau ein Stück einer Haube.
 */
function useSnowTracks(caps, enabled, level) {
  const [walk, setWalk] = useState(null);
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!enabled || walk || typeof window === "undefined") return undefined;
    const target = footerRun(caps);
    if (!target || tracksToday(window.localStorage)) return undefined;
    const visible = () => {
      const top = target.cap.y - (window.scrollY || 0);
      return top > 60 && top < window.innerHeight - 30;
    };
    if (!visible()) return undefined;
    // Das Bewegungsbudget lässt kurz nach dem Laden nichts starten (und nichts neben einer anderen großen Bewegung) -
    // solange die Fußzeile im Bild ist, fragt die Spur deshalb ein paar Mal nach.
    let attempts = 0;
    let timer = 0;
    const attempt = () => {
      if (!visible() || tracksToday(window.localStorage)) return;
      const token = requestMotion("snow_tracks");
      if (!token) {
        attempts += 1;
        if (attempts < 6) timer = window.setTimeout(attempt, 3000);
        return;
      }
      markTracks(window.localStorage);
      const fromLeft = hashString(`${new Date().toDateString()}:${target.cap.key}`) % 2 === 0;
      const steps = trackSteps({ width: target.width, thickness: capThickness(level, target.cap.growth), fromLeft });
      setWalk({ key: target.cap.key, run: target.index, steps, started: Date.now(), token, done: false });
    };
    timer = window.setTimeout(attempt, 1500);
    return () => window.clearTimeout(timer);
  }, [caps, enabled, walk, level]);
  const started = walk?.started;
  useEffect(() => {
    if (!walk || walk.done) return undefined;
    const total = tracksDuration(walk.steps);
    const lastStep = (walk.steps.length - 1) * TRACK_STEP_MS;
    let timer = 0;
    const tick = () => {
      const now = Date.now() - walk.started;
      setElapsed(now);
      if (now >= total) {
        releaseMotion(walk.token);
        setWalk((current) => (current ? { ...current, done: true } : current));
        return;
      }
      // Beim Laufen und beim Zurieseln oft nachsehen, in der Ruhe dazwischen selten.
      const busy = now < lastStep + 800 || now > lastStep + TRACK_REST_MS;
      timer = window.setTimeout(tick, busy ? 100 : 1000);
    };
    tick();
    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started]);
  useEffect(() => () => {
    if (walk?.token && !walk.done) releaseMotion(walk.token);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  if (!walk || walk.done) return null;
  return { key: walk.key, run: walk.run, dents: dentsAt(walk.steps, elapsed) };
}

/** Eine Haube: je freiem Stück der Kante ein eigenes SVG, damit ihr Kasten nur dort liegt, wo Schnee ist. */
function Cap({ cap, level, light, moonX, track = null }) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  const thickness = capThickness(level, cap.growth);
  const base = thickness + OVERHANG;
  return cap.runs.map((run, index) => {
    const width = run.to - run.from;
    const dents = track && track.run === index ? track.dents : [];
    const { d, height } = capPath({ width, thickness, seed: `${cap.seed}:${index}`, level, dents });
    const viewWidth = typeof window === "undefined" ? 1280 : window.innerWidth || 1280;
    const tone = snowLightAt(light, (cap.x - (typeof window === "undefined" ? 0 : window.scrollX || 0) + run.from + width / 2) / viewWidth, moonX);
    return (
      <svg
        key={`${cap.key}:${index}`}
        className={`tls-snowcap${cap.yield ? " tls-snowcap--yield" : ""}`}
        style={{ transform: `translate(${(cap.x + run.from).toFixed(1)}px, ${(cap.y - base).toFixed(1)}px)`, width: `${width.toFixed(1)}px`, height: `${height.toFixed(1)}px` }}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        aria-hidden="true"
        data-testid="snow-cap"
        data-kind={cap.kind}
        data-level={level}
        data-yield={cap.yield ? "1" : undefined}
        data-tone={tone.top}
        data-tracks={dents.length || undefined}
      >
        <defs>
          <linearGradient id={`${ids}-${index}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor={tone.top} />
            <stop offset="0.7" stopColor={tone.mid} />
            <stop offset="1" stopColor={tone.bottom} />
          </linearGradient>
        </defs>
        <path d={d} fill={`url(#${ids}-${index})`} />
        {dents.filter((dent) => dent.fresh).map((dent) => [-1, 0, 1].map((side) => (
          <circle key={`${dent.x}:${side}`} className="tls-snow-crumb" cx={dent.x} cy={base - thickness} r={0.9} style={{ "--dx": `${side * 3}px` }} />
        )))}
      </svg>
    );
  });
}

/**
 * Hauben auf den Kanten im Fenster. `stage` (1–3) und `tempC` vom Server bzw. Wetter, `salt` das Jahres-Salz,
 * `max` die Obergrenze je Seite (Klasse), `light` das Licht des Himmels (skyLight.js), `moonX` wo der Mond steht.
 */
export function SnowCaps({ stage = 1, tempC = null, salt = "", max = 24, light = DAYLIGHT, moonX = null, tracks: tracksOn = false }) {
  const location = useLocation();
  const [caps, setCaps] = useState([]);
  const capsRef = useRef([]);
  const level = capLevel({ stage, tempC });

  useEffect(() => {
    capsRef.current = [];
    setCaps([]);
    if (!max || typeof document === "undefined") return undefined;
    const win = window;
    let cancelled = false;
    const apply = (next) => {
      capsRef.current = next;
      setCaps(next);
    };
    const refresh = () => {
      if (cancelled) return;
      const zones = measureQuietZones(document, win);
      const next = measureCaps(document, win, { zones, salt, max }).map((cap) => ({ ...cap, yield: capYields(cap, zones) }));
      if (!sameCaps(next, capsRef.current)) apply(next);
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
    return () => {
      cancelled = true;
      timers.forEach((timer) => win.clearTimeout(timer));
      win.clearTimeout(debounce);
      win.clearTimeout(scrollSettle);
      win.removeEventListener("resize", onLayout);
      win.removeEventListener("scroll", onScroll);
      observer?.disconnect();
      stopWatching();
    };
  }, [location.pathname, salt, max]);

  const track = useSnowTracks(caps, tracksOn, level);
  if (typeof document === "undefined" || !caps.length) return null;
  return createPortal(
    <div className="tls-snowcaps" aria-hidden="true" data-testid="snow-caps" data-level={level}>
      {caps.map((cap) => <Cap key={cap.key} cap={cap} level={level} light={light || DAYLIGHT} moonX={moonX} track={track && track.key === cap.key ? track : null} />)}
    </div>,
    document.body,
  );
}
