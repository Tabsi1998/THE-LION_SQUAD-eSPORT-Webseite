import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { useSeason } from "../SeasonContext";
import { EggShape } from "../easterHunt/EggShape";
import { onHuntActive } from "../easterHunt/api";
import { FlowerArt, GrassTuft } from "./art";
import { ROW_EGG, ROW_HEIGHT, ROW_STEP, freeAt, rowPatterns, rowSpot } from "./plan";

// Die Reihe unter der Kopfzeile (#645): sechs bemalte Eier (am Handy drei) in einem Grasstreifen, rechts in der Spalte
// des Inhalts oder in der Mitte - nur, wo darunter nichts steht. Sie gehört zur Seite (scrollt unter die Kopfzeile)
// und wird beim Laden oben gemessen. Läuft die Eiersuche wirklich, stehen dort Blumen statt Eiern: Eier, die man
// nicht sammeln kann, sähen sonst genauso aus wie die versteckten.

const FLOWERS = ["daisy", "tulip", "primrose", "crocus", "daisy", "tulip"];

/** Die Inhaltskante eines Elements (ohne Innenabstand) - so steht die Reihe bündig mit Knöpfen und Text. */
export function contentEdges(element) {
  if (!element) return null;
  const rect = element.getBoundingClientRect();
  const style = window.getComputedStyle(element);
  return { left: rect.left + (parseFloat(style.paddingLeft) || 0), right: rect.right - (parseFloat(style.paddingRight) || 0), top: rect.top, bottom: rect.bottom };
}

const REMEASURE_MS = [400, 1600];

export function EggRow({ moving }) {
  const location = useLocation();
  const { byKey } = useSeason();
  const huntWindow = Boolean(byKey?.easter_hunt && byKey.easter_hunt.effective !== "off");
  const [huntActive, setHuntActive] = useState(null);
  const [seed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [spot, setSpot] = useState(null);

  useEffect(() => (huntWindow ? onHuntActive(setHuntActive) : undefined), [huntWindow]);

  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let placed = false;
    const measure = () => {
      const header = document.querySelector("header");
      // Gemessen wird oben auf der Seite - weiter unten liegt die Stelle unter der klebenden Kopfzeile.
      if (!header || (window.scrollY || 0) > 40) return;
      const frame = header.getBoundingClientRect();
      const column = contentEdges(header.firstElementChild) || frame;
      const clientWidth = document.documentElement.clientWidth || window.innerWidth;
      const found = rowSpot(frame, column, clientWidth, (x, y) => freeAt(document, x, y));
      placed = true;
      setSpot(found ? { ...found, left: found.left + (window.scrollX || 0), top: found.top + (window.scrollY || 0) } : null);
    };
    const timers = REMEASURE_MS.map((ms) => window.setTimeout(measure, ms));
    const onScroll = () => {
      if (!placed) measure();
    };
    const onResize = () => {
      placed = false;
      measure();
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onResize);
    return () => {
      timers.forEach(window.clearTimeout);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onResize);
    };
  }, [location.pathname]);

  if (!spot || typeof document === "undefined") return null;
  // Im Fenster der Suche: erst Blumen, Eier nur, wenn feststeht, dass sie nicht läuft.
  const eggs = !huntWindow || huntActive === false;
  const patterns = rowPatterns(seed, spot.count);
  return createPortal(
    <div className={`tls-easter-layer tls-easter-row${moving ? " tls-easter-row--sway" : ""}`} style={{ left: `${spot.left}px`, top: `${spot.top}px`, width: `${spot.width}px`, height: `${ROW_HEIGHT}px` }} aria-hidden="true" data-testid="easter-row" data-items={eggs ? "eggs" : "flowers"}>
      {patterns.map((pattern, index) => (
        <span key={pattern} className="tls-easter-row__item" style={{ left: `${9 + index * ROW_STEP}px`, animationDelay: `${(index * 0.37) % 2}s` }} data-testid="easter-row-item">
          {eggs ? <EggShape pattern={pattern} size={ROW_EGG} /> : <FlowerArt kind={FLOWERS[index % FLOWERS.length]} height={20} />}
        </span>
      ))}
      <span className="tls-easter-row__grass">
        {Array.from({ length: Math.ceil(spot.width / 14) }, (_, index) => <GrassTuft key={index} width={14} height={9 + (index % 3)} blades={3 + (index % 2)} />)}
      </span>
    </div>,
    document.body,
  );
}
