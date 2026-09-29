import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { measureQuietZones, overlayZones, rectInQuiet, watchOverlays } from "../quiet";
import { OVERHANG, capLevel, capPath, capThickness, measureCaps } from "./caps";

// Schneehauben (S7, #638; W3, #729): still auf den Oberkanten von Karten, Rahmen und der Fußzeile im Fenster - je
// Kante eine eigene Kontur und ein eigenes Wachstum aus dem Jahres-Seed, nur auf freien Stücken (nie über Abzeichen,
// Knöpfen, Schrift), mit der Stufe des Servers und dem Tauwetter des echten Wetters. Beim Scrollen kommen weitere
// Kanten dazu; unter geöffneten Dialogen und Menüs weicht eine Haube aus. Ohne Bewegung bleiben die Hauben - sie
// bewegen sich ohnehin nicht. Verschiebt kein Layout: liegt als eigene Ebene über der Kante.

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

/** Eine Haube: je freiem Stück der Kante ein eigenes SVG, damit ihr Kasten nur dort liegt, wo Schnee ist. */
function Cap({ cap, level }) {
  const ids = useId().replace(/[^a-zA-Z0-9]/g, "");
  const thickness = capThickness(level, cap.growth);
  const base = thickness + OVERHANG;
  return cap.runs.map((run, index) => {
    const width = run.to - run.from;
    const { d, height } = capPath({ width, thickness, seed: `${cap.seed}:${index}`, level });
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
      >
        <defs>
          <linearGradient id={`${ids}-${index}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="#ffffff" />
            <stop offset="0.7" stopColor="#e6eff8" />
            <stop offset="1" stopColor="#c7d8ea" />
          </linearGradient>
        </defs>
        <path d={d} fill={`url(#${ids}-${index})`} />
      </svg>
    );
  });
}

/**
 * Hauben auf den Kanten im Fenster. `stage` (1–3) und `tempC` vom Server bzw. Wetter, `salt` das Jahres-Salz,
 * `max` die Obergrenze je Seite (Klasse).
 */
export function SnowCaps({ stage = 1, tempC = null, salt = "", max = 24 }) {
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

  if (typeof document === "undefined" || !caps.length) return null;
  return createPortal(
    <div className="tls-snowcaps" aria-hidden="true" data-testid="snow-caps" data-level={level}>
      {caps.map((cap) => <Cap key={cap.key} cap={cap} level={level} />)}
    </div>,
    document.body,
  );
}
