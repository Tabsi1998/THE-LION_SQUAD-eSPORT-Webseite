import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { FlowerArt, GrassTuft } from "./art";
import { contentEdges } from "./EggRow";
import { MEADOW_HEIGHT, contentRects, freeMeadow, meadowPlan } from "./plan";

// Die Wiese über der Fußzeile (#645 „Blumenwiese unten“, #753): Blumen und Grasbüschel wachsen aus der Oberkante der
// Fußzeile in den freien Abstand darüber (ihren Rand), in der Breite der Spalte des Inhalts - und jede einzeln nur
// dort, wo darunter keine Schrift, kein Bild und kein Knopf liegt (manche Seiten reichen bis in diesen Rand). Sie
// gehört zur Seite und wandert mit, wenn die Seite wächst. Die Blumen wiegen sich leise; ohne Bewegung und am
// Karfreitag stehen sie still.

/** Wo die Wiese liegt (Seitenkoordinaten) - null, wenn über der Fußzeile kein freier Rand ist. */
export function meadowSpot(footer, column, scroll, marginTop) {
  if (!footer || marginTop < MEADOW_HEIGHT + 8) return null;
  const left = Math.round(column.left + scroll.x);
  const width = Math.round(column.right - column.left);
  if (width < 120) return null;
  return { left, top: Math.round(footer.top + scroll.y - MEADOW_HEIGHT), width };
}

export function Meadow({ year, small, moving }) {
  const location = useLocation();
  const [spot, setSpot] = useState(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let frame = 0;
    const measure = () => {
      const footer = document.querySelector("footer");
      if (!footer) {
        setSpot(null);
        return;
      }
      const header = document.querySelector("header");
      const column = contentEdges(header?.firstElementChild) || footer.getBoundingClientRect();
      const marginTop = parseFloat(window.getComputedStyle(footer).marginTop) || 0;
      const scroll = { x: window.scrollX || 0, y: window.scrollY || 0 };
      const found = meadowSpot(footer.getBoundingClientRect(), column, scroll, marginTop);
      // Was in den Rand reicht, in Koordinaten der Wiese (links oben = 0, 0).
      const blocked = found ? contentRects(document.querySelector("main") || document.body, { left: found.left - scroll.x, right: found.left - scroll.x + found.width, top: found.top - scroll.y, bottom: found.top - scroll.y + MEADOW_HEIGHT })
        .map((rect) => ({ left: rect.left + scroll.x - found.left, right: rect.right + scroll.x - found.left, top: rect.top + scroll.y - found.top, bottom: rect.bottom + scroll.y - found.top })) : [];
      const next = found ? { ...found, blocked, key: JSON.stringify(blocked.map((rect) => [Math.round(rect.left), Math.round(rect.right)])) } : null;
      setSpot((current) => (current && next && current.left === next.left && current.top === next.top && current.width === next.width && current.key === next.key ? current : next));
    };
    const soon = () => {
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(measure);
    };
    const timer = window.setTimeout(measure, 300);
    // Die Fußzeile rutscht, wenn die Seite nachlädt - die Wiese geht mit.
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(soon);
    if (observer && document.body) observer.observe(document.body);
    window.addEventListener("resize", soon);
    return () => {
      window.clearTimeout(timer);
      window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", soon);
    };
  }, [location.pathname]);
  const items = useMemo(() => (spot ? freeMeadow(meadowPlan(spot.width, { year, route: location.pathname, small }), spot.blocked) : []), [spot, year, location.pathname, small]);
  if (!spot || !items.length || typeof document === "undefined") return null;
  return createPortal(
    <div className={`tls-easter-layer tls-meadow${moving ? " tls-meadow--sway" : ""}`} style={{ left: `${spot.left}px`, top: `${spot.top}px`, width: `${spot.width}px`, height: `${MEADOW_HEIGHT}px` }} aria-hidden="true" data-testid="easter-meadow">
      {items.map((item) => (
        <span key={`${item.kind}:${item.x}`} className={`tls-meadow__item tls-meadow__item--${item.kind === "grass" ? "grass" : "flower"}`} style={{ left: `${item.x}px`, "--sway": `${item.sway || 4}s`, animationDelay: `${item.delay || 0}ms` }} data-testid={item.kind === "grass" ? "easter-meadow-grass" : "easter-meadow-flower"}>
          {item.kind === "grass" ? <GrassTuft width={item.width} height={item.height} blades={item.blades} /> : <FlowerArt kind={item.kind} height={item.height} />}
        </span>
      ))}
    </div>,
    document.body,
  );
}
