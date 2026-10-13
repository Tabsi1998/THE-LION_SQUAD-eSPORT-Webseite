import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RING from "@/lib/loewenRangRing.json";
import { useReducedMotion } from "@/hooks/useLiveChanges";
import { canvasDpr, signatureFor } from "@/lib/loewenSignatur";
import { createSignatureEngine, fallbackEdge, signatureGeometry } from "./loewenSignaturEngine";

/* Löwen-Rang Teil 2 (#1455): die Signatur des Rangs als leichtes Canvas über dem Rahmen - nur im Profilkopf.
   LevelAvatarFrame lädt diese Datei erst bei Bedarf (dynamischer Import), das Profil-Bundle wächst nicht.
   Zwei Leinwände: hinten (Licht, Nebel, Wolken, Strahlen hinter Foto und Rahmen) und vorne (Funken, Flammen, Blitze;
   der Fotokreis bleibt dort frei). Beide nehmen keine Klicks an. Die Schleife läuft nur, solange die Seite sichtbar
   ist und der Kopf im Bild; mit „Bewegung reduzieren“ gibt es keinen Effekt. */

/** Die Leinwand in Einheiten der Fläche: ragt links/rechts 30 %, oben 50 % und unten 30 % über die Fläche. */
export const SIGNATURE_BOX = Object.freeze({ left: 0.3, top: 0.5, width: 1.6, height: 1.8 });

// Kantenpunkte aller Rahmen (scripts/loewen_rang_assets.py) - erst hier geladen, einmal je Sitzung.
// Die Fassung folgt den Bildern: ändert sich ein Rahmen, ändert sich sein `v` und damit die Adresse.
const GEO_VERSION = Object.keys(RING).sort().reduce((hash, key) => {
  let next = hash;
  for (const ch of `${key}:${RING[key].v || ""}`) next = (Math.imul(next, 31) + ch.charCodeAt(0)) >>> 0;
  return next;
}, 7).toString(36);
let geometryPromise = null;
export function loadEdges() {
  if (!geometryPromise) {
    geometryPromise = typeof fetch === "function"
      ? fetch(`/assets/loewen-rang/geometry.json?v=${GEO_VERSION}`)
        .then((res) => (res.ok ? res.json() : {}))
        .catch(() => ({}))
      : Promise.resolve({});
  }
  return geometryPromise;
}

const boxStyle = {
  left: `calc(var(--lvf-s) * ${-SIGNATURE_BOX.left})`,
  top: `calc(var(--lvf-s) * ${-SIGNATURE_BOX.top})`,
  width: `calc(var(--lvf-s) * ${SIGNATURE_BOX.width})`,
  height: `calc(var(--lvf-s) * ${SIGNATURE_BOX.height})`,
};

/**
 * `level` bestimmt Rang, Signatur und Stärke; `fit`, `scale`, `ox`, `oy` und `ring` kommen aus levelFrameConfig - dieselbe
 * Geometrie wie der Rahmen, damit die Partikel an seiner Außenkante entstehen.
 * `burst` ({ id, strong, delay }) spielt einmal den Aufstiegs-Moment (#1456) - auch beim ersten Level eines Rangs, wenn
 * die Signatur selbst noch ruht. `onJolt` meldet, wenn der Moment den Rahmen beben lässt (Brüller, Obsidian, Sturm).
 */
export default function LoewenRangSignature({ level, fit, scale, ox, oy, ring, burst = null, onJolt = null }) {
  const backRef = useRef(null);
  const frontRef = useRef(null);
  const reduced = useReducedMotion();
  const sig = useMemo(() => signatureFor(level), [level]);
  const [edges, setEdges] = useState(null);
  const active = !reduced && (sig.layers.length > 0 || Boolean(burst));
  const engineRef = useRef(null);
  const burstRef = useRef(burst);
  burstRef.current = burst;
  const joltRef = useRef(onJolt);
  joltRef.current = onJolt;
  // Je Engine spielt jeder Moment höchstens einmal - auch wenn React die Wirkung doppelt ansetzt.
  const playedRef = useRef(new WeakMap());
  const playBurst = useCallback(() => {
    const engine = engineRef.current;
    const next = burstRef.current;
    if (!engine || !next?.id) return;
    const played = playedRef.current.get(engine) || new Set();
    if (played.has(next.id)) return;
    played.add(next.id);
    playedRef.current.set(engine, played);
    engine.burst(next.strong !== false, { delay: Number(next.delay) || 0 });
  }, []);

  useEffect(() => {
    if (!active) return undefined;
    let alive = true;
    loadEdges().then((geo) => {
      if (alive) setEdges(geo?.[sig.key]?.edge?.length ? geo[sig.key].edge : fallbackEdge(ring));
    });
    return () => { alive = false; };
  }, [active, sig.key, ring]);

  useEffect(() => {
    const back = backRef.current;
    const front = frontRef.current;
    if (!active || !edges || !back || !front || typeof window === "undefined" || typeof window.requestAnimationFrame !== "function") return undefined;
    const engine = createSignatureEngine({
      back,
      front,
      fx: sig.fx,
      k: sig.k,
      edge: edges,
      dpr: canvasDpr(window.devicePixelRatio),
      layout: (width) => signatureGeometry({ width, box: SIGNATURE_BOX, fit, scale, ox, oy }),
      onJolt: () => joltRef.current?.(),
    });
    engineRef.current = engine;
    let raf = 0;
    // Mit Beobachter erst laufen, wenn er „im Bild“ meldet - ein Kopf außerhalb des Bildes animiert nie, auch nicht kurz.
    const canObserve = typeof IntersectionObserver === "function";
    let inView = !canObserve;
    const tick = (now) => {
      raf = 0;
      if (document.hidden || !inView) return;
      engine.frame(now);
      raf = window.requestAnimationFrame(tick);
    };
    const run = () => {
      if (raf || document.hidden || !inView) return;
      engine.resume();
      raf = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      if (raf) window.cancelAnimationFrame(raf);
      raf = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : run());
    document.addEventListener("visibilitychange", onVisibility);
    const resizeObserver = typeof ResizeObserver === "function" ? new ResizeObserver(() => engine.resize()) : null;
    resizeObserver?.observe(front);
    const viewObserver = canObserve
      ? new IntersectionObserver(([entry]) => {
        inView = Boolean(entry?.isIntersecting);
        if (inView) run();
        else stop();
      })
      : null;
    viewObserver?.observe(front);
    engine.resize();
    playBurst();
    run();
    return () => {
      engineRef.current = null;
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
      resizeObserver?.disconnect();
      viewObserver?.disconnect();
      engine.reset();
    };
  }, [active, edges, sig.fx, sig.k, fit, scale, ox, oy, playBurst]);

  // Ein neuer Moment auf einer laufenden Engine.
  useEffect(() => {
    playBurst();
  }, [burst?.id, playBurst]);

  if (!active) return null;
  return (
    <>
      <canvas ref={backRef} className="tls-lvf-sig tls-lvf-sig--back" style={boxStyle} aria-hidden="true" />
      <canvas
        ref={frontRef}
        className="tls-lvf-sig tls-lvf-sig--front"
        style={boxStyle}
        aria-hidden="true"
        data-testid="loewen-signature"
        data-signature={sig.fx}
        data-intensity={sig.k.toFixed(2)}
        data-layers={sig.layers.join(" ")}
        data-burst={burst?.id ? (burst.strong === false ? "small" : "strong") : undefined}
      />
    </>
  );
}
