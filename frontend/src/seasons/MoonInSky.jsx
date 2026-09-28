import { useEffect, useState } from "react";
import { moonPosition, skyPlacement } from "./astronomy";

// Der Mond am Seitenhimmel (#681): steht dort, wo er über dem Vereinsort wirklich steht - geht auf, wandert nach
// Westen, geht unter. Jede Minute neu gerechnet, die Bewegung dazwischen als weicher Übergang; beim ersten Bild ohne
// Übergang, damit nichts über den Schirm springt. Ohne Ort rechnet er mit Innsbruck. Saisonneutral: die Saison gibt
// nur die Zeichnung (`render`) dazu, Halloween den Mond mit Phase, der Winter später denselben Mond über Schnee.

export const DEFAULT_LOCATION = { name: "Innsbruck", lat: 47.2692, lon: 11.4041 };
export const TICK_MS = 60000;

export function useMoonPlacement({ location, now = () => new Date(), viewport = null, tick = TICK_MS } = {}) {
  const [state, setState] = useState(() => compute(location, now(), viewport));
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const update = () => setState(compute(location, now(), viewport));
    update();
    const timer = window.setInterval(update, tick);
    window.addEventListener("resize", update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("resize", update);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location?.lat, location?.lon, tick]);
  return state;
}

function compute(location, at, viewport) {
  const place = location && Number.isFinite(Number(location.lat)) && Number.isFinite(Number(location.lon)) ? { lat: Number(location.lat), lon: Number(location.lon) } : DEFAULT_LOCATION;
  const size = viewport || (typeof window === "undefined" ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight });
  const position = moonPosition(at, place.lat, place.lon);
  return { ...position, ...skyPlacement(position, size), at };
}

/**
 * `render(props)` zeichnet den Mond (SVG); `location` {lat, lon}; `now` nur für Tests. Unter dem Horizont bleibt der
 * Halter leer, damit die Seite weiß, dass es den Mond gerade nicht gibt (data-visible).
 */
export function MoonInSky({ location, render, now = () => new Date(), viewport = null, tick = TICK_MS }) {
  const placement = useMoonPlacement({ location, now, viewport, tick });
  const [settled, setSettled] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const timer = window.setTimeout(() => setSettled(true), 120);
    return () => window.clearTimeout(timer);
  }, []);
  const style = {
    left: `${placement.x.toFixed(1)}px`,
    top: `${placement.y.toFixed(1)}px`,
    "--moon-scale": placement.scale.toFixed(3),
    "--moon-warmth": placement.warmth.toFixed(3),
  };
  return (
    <div
      className={`tls-moon-sky ${settled ? "tls-moon-sky--settled" : ""}`}
      style={style}
      aria-hidden="true"
      data-testid="season-moon"
      data-visible={placement.visible ? "1" : "0"}
      data-altitude={placement.altitude.toFixed(1)}
      data-azimuth={placement.azimuth.toFixed(0)}
    >
      {placement.visible && render({ placement })}
    </div>
  );
}
