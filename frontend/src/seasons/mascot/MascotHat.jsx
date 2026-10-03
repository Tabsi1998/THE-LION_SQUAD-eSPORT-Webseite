import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import { TEXT_LIKE } from "../anchors";
import { blocksPoint } from "../glyphs";
import { HEAD_FALLBACK, headTop } from "./head";
import "./mascot.css";

// Etwas auf dem Kopf des Löwen (gemeinsam für Partyhut #746 und Hasenohren #645): im Kopf der Seite auf dem Löwen
// im Schriftzug (das Stück hängt in der Kopfzeile selbst - es klebt mit ihr oben, und Dialoge und Menüs liegen
// darüber) und auf der Startseite auf dem großen Löwen (gehört zur Seite und scrollt mit). Der Scheitel kommt aus dem Bild; der große weicht der Schrift darüber
// aus - erst kleiner, dann tiefer, sonst gar nicht. Antippen lässt es wippen (die Saison entscheidet, was dazu
// passiert), höchstens alle `cooldownMs`. Ohne Bewegung ist es nur ein Bild: kein Knopf, der nichts tut.
//
// Alle Stücke haben das Format 40 × 52 (Breite × Höhe): `Art` bekommt die Breite als `size`.

export const ART_RATIO = 1.3;
/** So viel Zeit lassen zwei Antipper mindestens zwischen sich (ohne Erfolge daran). */
export const DEFAULT_COOLDOWN_MS = 10000;
export const DEFAULT_WIGGLE_MS = 700;

/** Wo das Stück auf einem Bild sitzt (Fensterkoordinaten): auf dem Scheitel des Löwen, etwas eingesunken. */
export function hatSpot(rect, head, size, minTop = -Infinity) {
  return { left: Math.round(rect.left + head.x * rect.width - size / 2), top: Math.round(Math.max(minTop, rect.top + head.y * rect.height - size * 1.15)) };
}

/**
 * Wo im Stück nachgesehen wird (Anteile von Breite und Höhe): der ganze Kasten, nicht nur die Form - der Knopf fängt
 * dort Klicks ab -, mit etwas Rand für die Neigung; dazu Spitze, Schultern und Rand unten.
 */
export const HAT_PROBES = [[-0.06, 0], [0.5, 0], [1.06, 0], [-0.06, 0.5], [1.06, 0.5], [0.3, 0.3], [0.7, 0.3], [0.15, 0.62], [0.85, 0.62]];
/** Erst kleiner, dann tiefer in die Mähne: so groß wie möglich, aber nie in die Schrift darüber. */
export const HERO_HAT_SHARES = [0.2, 0.17, 0.14];
export const HERO_HAT_SINKS = [0, 0.15, 0.3];

/** Der Platz des großen Stücks: der erste aus Größe und Tiefe, über dem nichts liegt - sonst keiner. */
export function heroHatSpot(rect, head, free) {
  for (const share of HERO_HAT_SHARES) {
    const size = Math.round(rect.width * share);
    for (const sink of HERO_HAT_SINKS) {
      const at = hatSpot(rect, head, size);
      const top = Math.round(at.top + sink * size);
      if (HAT_PROBES.every(([px, py]) => free(at.left + px * size, top + py * size * ART_RATIO))) return { left: at.left, top, size };
    }
  }
  return null;
}

/** Was beim Platz des Stücks nicht zählt: die Stücke selbst (alle Saisonen) und `extra` (eigene Ebenen der Saison). */
export const HAT_LAYERS = ".tls-mascot-hat, .tls-mascot-hat-page";

/**
 * Frei für das große Stück: keine Schrift (mit ihrem ganzen Kasten), kein Bild, kein Bedienelement - die Stücke
 * selbst und der Löwe, auf dem es sitzt, zählen nicht.
 */
export function hatRoom(doc, x, y, anchor = null, extra = "") {
  const ignore = extra ? `${HAT_LAYERS}, ${extra}` : HAT_LAYERS;
  const hits = typeof doc.elementsFromPoint === "function" ? doc.elementsFromPoint(x, y) : [];
  return !hits.some((el) => {
    if (el.closest(ignore)) return false;
    if (anchor && anchor.contains(el)) return false;
    return el.matches(TEXT_LIKE) || blocksPoint(el, x, y);
  });
}

/** Wartet, bis ein Bild geladen ist, und misst dann - auch nach neuer Fenstergröße. */
export function useImageSpot(selector, measure, deps) {
  const [spot, setSpot] = useState(null);
  useEffect(() => {
    if (typeof document === "undefined") return undefined;
    let image = null;
    const run = () => {
      image = document.querySelector(selector);
      if (!image || !image.complete || !(image.naturalWidth > 0)) {
        setSpot(null);
        return;
      }
      setSpot(measure(image));
    };
    run();
    const retry = window.setTimeout(run, 600);
    image?.addEventListener?.("load", run);
    window.addEventListener("resize", run);
    return () => {
      window.clearTimeout(retry);
      image?.removeEventListener?.("load", run);
      window.removeEventListener("resize", run);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return spot;
}

/**
 * Ein Stück, das sich antippen lässt: wippt (`wiggleClass`) und meldet den Punkt an `onTap` - höchstens alle
 * `cooldownMs`. Ohne Bewegung nur ein Bild.
 */
export function MascotHatButton({ Art, size, style, moving, label, title, testId, className = "", onTap = null, cooldownMs = DEFAULT_COOLDOWN_MS, wiggleMs = DEFAULT_WIGGLE_MS, wiggleClass = "tls-mascot-hat--wiggle" }) {
  const ref = useRef(null);
  const last = useRef(0);
  const [wiggle, setWiggle] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  if (!moving) {
    return (
      <span className={`tls-mascot-hat tls-mascot-hat--still ${className}`} style={style} aria-hidden="true" data-testid={testId}>
        <Art size={size} />
      </span>
    );
  }
  const onClick = () => {
    const now = Date.now();
    if (now - last.current < cooldownMs) return;
    last.current = now;
    setWiggle(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setWiggle(false), wiggleMs);
    const box = ref.current?.getBoundingClientRect();
    if (box && onTap) onTap({ x: box.left + box.width / 2, y: box.top + box.height * 0.3 });
  };
  return (
    <button ref={ref} type="button" className={`tls-mascot-hat ${className}${wiggle ? ` ${wiggleClass}` : ""}`} style={style} onClick={onClick} aria-label={label} title={title} data-testid={testId}>
      <Art size={size} />
    </button>
  );
}

/**
 * Das Stück auf dem Löwen im Kopf der Seite: in der Kopfzeile selbst (Koordinaten relativ zu ihr) - so klebt es mit
 * ihr oben, und was über der Kopfzeile liegt (Dialoge), liegt auch über dem Stück.
 */
export function HeaderMascotHat({ className = "", ...props }) {
  const spot = useImageSpot("header [data-testid='tls-logo']", (image) => {
    const rect = image.getBoundingClientRect();
    const header = image.closest("header");
    if (rect.width < 20 || !header) return null;
    const size = Math.max(14, Math.round(rect.height * 0.46));
    const frame = header.getBoundingClientRect();
    // Im Kopf ist über dem Löwen kaum Platz: das Stück bleibt ganz in der Kopfzeile und sitzt dafür etwas tiefer.
    const at = hatSpot(rect, headTop(image, "wordmark") || HEAD_FALLBACK.wordmark, size, frame.top + 2);
    return { left: at.left - frame.left, top: at.top - frame.top, size, header };
  }, []);
  if (!spot) return null;
  return createPortal(
    <MascotHatButton {...props} style={{ left: `${spot.left}px`, top: `${spot.top}px` }} size={spot.size} className={`tls-mascot-hat--header ${className}`} />,
    spot.header,
  );
}

/** Das Stück auf dem großen Löwen der Startseite - gehört zur Seite und scrollt mit. `ignore`: eigene Ebenen. */
export function HeroMascotHat({ className = "", ignore = "", ...props }) {
  const location = useLocation();
  const spot = useImageSpot("[data-season-anchor='lion'] img", (image) => {
    const rect = image.getBoundingClientRect();
    if (rect.width < 80) return null;
    const anchor = image.closest("[data-season-anchor='lion']");
    const at = heroHatSpot(rect, headTop(image, "mascot") || HEAD_FALLBACK.mascot, (x, y) => hatRoom(document, x, y, anchor, ignore));
    return at ? { left: at.left + (window.scrollX || 0), top: at.top + (window.scrollY || 0), size: at.size } : null;
  }, [location.pathname]);
  if (!spot || typeof document === "undefined") return null;
  return createPortal(
    <div className="tls-mascot-hat-page" style={{ left: `${spot.left}px`, top: `${spot.top}px` }}>
      <MascotHatButton {...props} size={spot.size} className={`tls-mascot-hat--hero ${className}`} />
    </div>,
    document.body,
  );
}
