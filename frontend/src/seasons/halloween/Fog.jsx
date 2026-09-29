import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { fogStrength } from "./atmosphere";

// Nebel (H14, #702): zwei sehr leise Ebenen unten im Bild, als Screen-Mischung - sie hellen nur dunkle Flächen
// einen Hauch auf, Schrift bleibt wie sie ist. Stärker am Seitenanfang und am Ende (Fußzeile), dazwischen fast
// unsichtbar; treiben langsam mit dem Wind (`--season-wind`), minimale Parallaxe über `--season-scroll`. `far`
// zeigt nur die ferne Ebene (ruhige Seiten, Handy, „dezent“), `near` beide; ohne Bewegung steht alles still.

/**
 * `level`: none | far | near. `moving` false = keine Drift, keine Parallaxe (Reduced Motion, „dezent“).
 */
export function Fog({ level = "none", moving = true }) {
  const ref = useRef(null);
  useEffect(() => {
    if (level === "none" || typeof window === "undefined") return undefined;
    let frame = 0;
    const update = () => {
      frame = 0;
      const strength = fogStrength({ scrollY: window.scrollY || 0, innerHeight: window.innerHeight, scrollHeight: document.documentElement.scrollHeight });
      ref.current?.style.setProperty("--fog-strength", String(strength));
      if (ref.current) ref.current.dataset.strength = String(strength);
    };
    const onChange = () => {
      if (!frame) frame = window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener("scroll", onChange, { passive: true });
    window.addEventListener("resize", onChange);
    return () => {
      window.removeEventListener("scroll", onChange);
      window.removeEventListener("resize", onChange);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [level]);
  if (level === "none" || typeof document === "undefined") return null;
  return createPortal(
    <div ref={ref} className={`tls-fog tls-fog--${level}${moving ? "" : " tls-fog--static"}`} aria-hidden="true" data-testid="halloween-fog" data-level={level}>
      <div className="tls-fog__layer tls-fog__layer--far" />
      {level === "near" && <div className="tls-fog__layer tls-fog__layer--near" />}
    </div>,
    document.body,
  );
}
