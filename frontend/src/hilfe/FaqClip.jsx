import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { FORMEN, HANDY_QUERY, hilfeBild, hilfeClip } from "./index";

// Bild bzw. Schleife eines FAQ-Schritts (#2448). Die Schleife ist eine stumme Bewegung wie ein GIF (WebM VP9 oder
// MP4 H.264), das Bild des Schritts ist ihr Poster. Regeln:
// - Fassung je Gerät über matchMedia (HANDY_QUERY), ohne User-Agent; ändert sich die Breite, wechselt sie mit.
// - Geladen wird erst, wenn der Schritt ins Bild kommt (IntersectionObserver); bis dahin steht nur das Bild da
//   (loading="lazy"). Außerhalb des Bildes hält die Schleife an, im Bild läuft sie weiter.
// - „Bewegung reduzieren“: nur das Bild mit Knopf „Abspielen“. Sonst gibt es den Knopf „Anhalten“.
// - Fehlt die Schleife, kann der Browser sie nicht abspielen oder bricht das Laden ab: das Bild bleibt (wie bisher).
// - Ohne IntersectionObserver (sehr alte Browser) bleibt es beim Bild.
// Der Schritttext beschreibt den Inhalt; die Schleife trägt nur ein kurzes Label wie das Bild sein alt.

const REDUCE_QUERY = "(prefers-reduced-motion: reduce)";

function mediaQuery(query) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(query) : null;
}

function useMedia(query, fallback) {
  const [matches, setMatches] = useState(() => mediaQuery(query)?.matches ?? fallback());
  useEffect(() => {
    const list = mediaQuery(query);
    if (!list) return undefined;
    const update = () => setMatches(list.matches);
    update();
    if (typeof list.addEventListener === "function") {
      list.addEventListener("change", update);
      return () => list.removeEventListener("change", update);
    }
    list.addListener?.(update);
    return () => list.removeListener?.(update);
  }, [query, fallback]);
  return matches;
}

const narrowFallback = () => typeof window !== "undefined" && window.innerWidth < 768;
const noFallback = () => false;

/** „handy“ oder „pc“ - folgt der Breite (und Touch bis Tablet-Breite). */
export function useHilfeForm() {
  return useMedia(HANDY_QUERY, narrowFallback) ? "handy" : "pc";
}

function canPlay(type) {
  try {
    return typeof document !== "undefined" && document.createElement("video").canPlayType?.(type) !== "";
  } catch {
    return false;
  }
}

/** WebM (kleiner), wenn der Browser VP9 kann - sonst MP4 (H.264, etwa ältere iPhones). */
export function clipQuelle(clip) {
  if (!clip) return null;
  if (clip.webm && canPlay('video/webm; codecs="vp9"')) return { src: clip.webm, type: "video/webm" };
  if (clip.mp4) return { src: clip.mp4, type: "video/mp4" };
  return clip.webm ? { src: clip.webm, type: "video/webm" } : null;
}

export default function FaqClip({ slug, schritt }) {
  const form = useHilfeForm();
  const reduce = useMedia(REDUCE_QUERY, noFallback);
  const figureRef = useRef(null);
  const videoRef = useRef(null);
  const [inView, setInView] = useState(false);
  const [seen, setSeen] = useState(false);
  // null = wie vorgesehen (läuft, außer bei „Bewegung reduzieren“); true/false = Knopf gedrückt.
  const [wanted, setWanted] = useState(null);
  const [playing, setPlaying] = useState(false);
  const [failed, setFailed] = useState("");

  const other = FORMEN.find((item) => item !== form);
  const bild = hilfeBild(slug, schritt.id, form) || hilfeBild(slug, schritt.id, other);
  const quelle = schritt.clip ? clipQuelle(hilfeClip(slug, schritt.id, form)) : null;
  const quelleSrc = quelle?.src || "";
  const hasClip = Boolean(quelle && bild) && failed !== quelleSrc;
  const allowed = reduce ? wanted === true : wanted !== false;
  const mounted = hasClip && seen && (allowed || playing || wanted === false);

  useEffect(() => {
    const node = figureRef.current;
    if (!hasClip || !node || typeof window.IntersectionObserver !== "function") return undefined;
    const observer = new window.IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      setInView(visible);
      if (visible) setSeen(true);
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasClip]);

  // Abspielen nur im Bild und wenn erlaubt; sonst anhalten. play() kann abgelehnt werden (Stromsparen) - dann zeigt
  // der Knopf „Abspielen“.
  useEffect(() => {
    const video = videoRef.current;
    if (!mounted || !video) return;
    if (inView && allowed) {
      const result = video.play?.();
      if (result && typeof result.catch === "function") result.catch(() => setPlaying(false));
    } else {
      video.pause?.();
    }
  }, [mounted, inView, allowed, quelleSrc]);

  if (!bild) return null;
  const titel = schritt.titel;
  const toggle = () => {
    if (playing) {
      setWanted(false);
      videoRef.current?.pause?.();
    } else {
      setWanted(true);
      setSeen(true);
    }
  };

  return (
    <figure ref={figureRef} className="relative mt-4 w-fit max-w-full" data-testid={`help-step-media-${schritt.id}`} data-form={form}>
      {mounted ? (
        <video
          key={quelle.src}
          ref={videoRef}
          src={quelle.src}
          poster={bild.src}
          width={bild.width}
          height={bild.height}
          muted
          loop
          playsInline
          autoPlay={inView && allowed}
          preload="none"
          aria-label={`Animation: ${titel}`}
          data-testid={`help-step-clip-${schritt.id}`}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onError={() => { setFailed(quelle.src); setPlaying(false); }}
          className="block h-auto max-w-full rounded-sm border border-white/10 bg-[#0F0F10]"
        />
      ) : (
        <img src={bild.src} width={bild.width} height={bild.height} alt={`Bildschirmfoto: ${titel}`} loading="lazy" decoding="async"
          data-testid={`help-step-image-${schritt.id}`}
          className="block h-auto max-w-full rounded-sm border border-white/10 bg-[#0F0F10]" />
      )}
      {hasClip ? (
        <button type="button" onClick={toggle} data-testid={`help-step-clip-toggle-${schritt.id}`}
          aria-label={playing ? `Animation „${titel}“ anhalten` : `Animation „${titel}“ abspielen`}
          className="absolute bottom-2 right-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-sm border border-white/15 bg-black/75 px-3 text-xs font-bold uppercase tracking-wider text-white transition-colors duration-150 hover:border-[#29B6E8] hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#29B6E8]">
          {playing ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          {playing ? null : <span aria-hidden="true">Abspielen</span>}
        </button>
      ) : null}
    </figure>
  );
}
