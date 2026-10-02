import { useEffect, useMemo, useState } from "react";
import { TEXT_LIKE } from "../anchors";
import { blocksPoint } from "../glyphs";
import { MoonInSky } from "../MoonInSky";
import { Moon } from "../MoonArt";
import { winterStars } from "../skyLight";

// Der Winterhimmel (W4 #730): eine ruhige Tiefe hinter dem Inhalt - nachts ein leiser Blauschein, um Auf- und
// Untergang ein warmes Glühen auf der Seite der Sonne, Sterne nur in freien dunklen Flächen (nie im Kasten von
// Schrift, Bildern oder Bedienelementen) und der Mond der Saisons (MoonArt.jsx) dort, wo er über dem Vereinsort
// steht - liegt dort gerade Inhalt, tritt er zurück (blendet aus), statt den Kontrast zu nehmen. Wie deutlich alles
// ist, sagt das Licht (skyLight.js) aus Sonnenzeiten und Wetter. Alles liegt hinter dem Inhalt; die Sterne funkeln
// nur mit Bewegung.

/** Wann die Sterne neu nachsehen, ob ihre Stelle frei ist - nach dem Laden kommen oft noch Inhalte nach. */
export const STAR_CHECKS_MS = [300, 1500, 4000];
export const TWINKLE_SECONDS = 5.2;

/** Was eine Stelle für Himmel sperrt: der ganze Kasten von Schrift, Bildern, Grafiken und Bedienelementen. */
export const SKY_BLOCKERS = `${TEXT_LIKE}, img, picture, video, canvas, svg, iframe`;
/** Wo der Mond nachsieht: Mitte und acht Punkte am Rand seiner Scheibe (Halbmesser 30 bei Maßstab 1). */
export const MOON_PROBES = [[0, 0], ...Array.from({ length: 8 }, (_, i) => [Math.cos((i / 8) * Math.PI * 2), Math.sin((i / 8) * Math.PI * 2)])];

/** Ist die Stelle (Fensterkoordinaten) frei von Schrift, Bildern und Bedienelementen? Ohne Sonde: ja. */
export function pointFree(doc, x, y) {
  if (!doc || typeof doc.elementFromPoint !== "function") return true;
  let node = doc.elementFromPoint(x, y);
  if (node && typeof node.closest === "function" && node.closest(SKY_BLOCKERS)) return false;
  while (node && node !== doc.body && node !== doc.documentElement) {
    if (blocksPoint(node, x, y)) return false;
    node = node.parentElement;
  }
  return true;
}

function viewport() {
  return typeof window === "undefined" ? { width: 1280, height: 800 } : { width: window.innerWidth, height: window.innerHeight };
}

/** Nachsehen nach dem Laden, nach dem Scrollen und bei neuer Fenstergröße - `check` misst, `deps` sagen, wann neu. */
function useSettledCheck(check, deps) {
  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return undefined;
    let cancelled = false;
    const run = () => {
      if (!cancelled) check();
    };
    const timers = STAR_CHECKS_MS.map((ms) => window.setTimeout(run, ms));
    let settle = 0;
    const later = () => {
      window.clearTimeout(settle);
      settle = window.setTimeout(run, 250);
    };
    window.addEventListener("scroll", later, { passive: true });
    window.addEventListener("resize", later);
    return () => {
      cancelled = true;
      timers.forEach((timer) => window.clearTimeout(timer));
      window.clearTimeout(settle);
      window.removeEventListener("scroll", later);
      window.removeEventListener("resize", later);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Welche Sterne gerade frei stehen. */
function useFreeStars(stars) {
  const [state, setState] = useState(() => ({ size: viewport(), free: stars.map(() => false) }));
  useSettledCheck(() => {
    const size = viewport();
    setState({ size, free: stars.map((star) => pointFree(document, star.x * size.width, star.y * size.height)) });
  }, [stars]);
  return state;
}

/** Der Mond hinter dem Inhalt: nur, wo seine ganze Scheibe frei ist - sonst tritt er zurück. */
function WinterMoon({ placement, opacity }) {
  const [free, setFree] = useState(false);
  const x = Math.round(placement.x);
  const y = Math.round(placement.y);
  const radius = 30 * (placement.scale || 1);
  useSettledCheck(() => {
    setFree(MOON_PROBES.every(([dx, dy]) => pointFree(document, x + dx * radius, y + dy * radius)));
  }, [x, y, radius]);
  return (
    <div className="tls-winter-moon" style={{ opacity: free ? opacity : 0 }} data-testid="winter-moon" data-free={free ? "1" : "0"}>
      <Moon halo={2.2} />
    </div>
  );
}

/**
 * `light` aus skyLight(), `stars` wie viele Sterne die Seite höchstens bekommt, `moon` ob der Mond dazugehört,
 * `year` das Jahres-Salz der Saison, `moving` ob die Sterne funkeln dürfen, `location` der Vereinsort.
 */
export function WinterSky({ light, stars = 0, moon = false, year = "", moving = true, location = null }) {
  const count = Math.round(stars * Math.max(0, Math.min(1, light.stars)));
  const field = useMemo(() => winterStars(year, stars).slice(0, count), [year, stars, count]);
  const { size, free } = useFreeStars(field);
  return (
    <div className="tls-season-backdrop tls-winter-sky" aria-hidden="true" data-testid="winter-sky" data-night={light.night} data-warmth={light.warmth}>
      {light.night > 0.01 && <div className="tls-snow-tint" style={{ opacity: light.night }} data-testid="snow-tint" />}
      {light.warmth > 0.01 && <div className="tls-winter-glow" style={{ opacity: light.warmth, "--glow-x": `${Math.round(light.side * 100)}%` }} data-testid="winter-glow" />}
      {field.length > 0 && (
        <svg className={`tls-winter-stars${moving ? " tls-winter-stars--twinkle" : ""}`} width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`} data-testid="winter-stars">
          {field.map((star, i) => (
            <circle
              key={star.index}
              cx={(star.x * size.width).toFixed(1)}
              cy={(star.y * size.height).toFixed(1)}
              r={star.r}
              fill="#eef4ff"
              style={{ fillOpacity: free[i] ? star.bright : 0, animationDelay: `-${(star.phase * TWINKLE_SECONDS).toFixed(2)}s` }}
              data-free={free[i] ? "1" : "0"}
            />
          ))}
        </svg>
      )}
      {moon && light.moon > 0.02 && (
        <MoonInSky location={location} render={({ placement }) => <WinterMoon placement={placement} opacity={light.moon} />} />
      )}
    </div>
  );
}
