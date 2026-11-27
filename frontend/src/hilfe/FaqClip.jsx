import { useEffect, useRef, useState } from "react";
import { Pause, Play } from "lucide-react";
import { FORMEN, HANDY_QUERY, hilfeBild, hilfeClip } from "./index";

// Bild bzw. Schleife eines FAQ-Schritts (#2448). Die Schleife ist eine stumme Bewegung wie ein GIF (WebM VP9 oder
// MP4 H.264), das Bild des Schritts ist ihr Poster. Regeln:
// - Fassung je Gerät über matchMedia (HANDY_QUERY), ohne User-Agent; ändert sich die Breite, wechselt sie mit.
// - Geladen wird erst, wenn der Schritt ins Bild kommt (IntersectionObserver); bis dahin steht nur das Bild da
//   (loading="lazy"). Außerhalb des Bildes hält die Schleife an, im Bild läuft sie weiter.
// - „Bewegung reduzieren“: nur das Bild mit Knopf „Abspielen“. Sonst gibt es den Knopf „Anhalten“.
// - Lehnt der Browser das automatische Abspielen ab (Stromsparen), zeigt der Knopf „Abspielen“; der Klick startet
//   direkt in der Geste.
// - Bricht eine Quelle ab, kommt die andere Art (WebM → MP4); erst wenn keine geht, bleibt das Bild (wie bisher).
// - Ohne IntersectionObserver (sehr alte Browser) startet nichts von selbst; der Knopf „Abspielen“ geht trotzdem.
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

/**
 * Die Quellen in der Reihenfolge, in der sie versucht werden: WebM (kleiner) zuerst, wenn der Browser VP9 kann,
 * dann MP4 (H.264, etwa ältere iPhones); ohne VP9 steht WebM als letzter Versuch hinten.
 */
export function clipQuellen(clip) {
  if (!clip) return [];
  const webm = clip.webm ? { src: clip.webm, type: "video/webm" } : null;
  const mp4 = clip.mp4 ? { src: clip.mp4, type: "video/mp4" } : null;
  const order = webm && canPlay('video/webm; codecs="vp9"') ? [webm, mp4] : [mp4, webm];
  return order.filter(Boolean);
}

/** iOS spielt automatisch nur, wenn „stumm“ auch als Attribut und Vorgabe gesetzt ist - React setzt nur die Eigenschaft. */
function stumm(video) {
  video.defaultMuted = true;
  video.muted = true;
  video.setAttribute("muted", "");
}

function abspielen(video, onRejected) {
  stumm(video);
  const result = video.play?.();
  if (result && typeof result.catch === "function") result.catch(onRejected);
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
  // Der Browser hat das Abspielen abgelehnt (Stromsparen) - bis zum nächsten Klick bzw. Start.
  const [rejected, setRejected] = useState(false);
  const [failed, setFailed] = useState([]);

  const other = FORMEN.find((item) => item !== form);
  const bild = hilfeBild(slug, schritt.id, form) || hilfeBild(slug, schritt.id, other);
  const quelle = schritt.clip ? clipQuellen(hilfeClip(slug, schritt.id, form)).find((row) => !failed.includes(row.src)) || null : null;
  const quelleSrc = quelle?.src || "";
  const hasClip = Boolean(quelle && bild);
  const allowed = reduce ? wanted === true : wanted !== false;
  const mounted = hasClip && seen && (allowed || playing || wanted === false);
  // Was der Knopf anbietet: „Anhalten“, solange die Schleife läuft oder gleich von selbst startet.
  const active = playing || (mounted && allowed && inView && !rejected);

  useEffect(() => {
    const node = figureRef.current;
    if (!hasClip || !node) return undefined;
    if (typeof window.IntersectionObserver !== "function") {
      // Kein Beobachter: nichts lädt von selbst (seen bleibt aus), aber „Abspielen“ startet sofort.
      setInView(true);
      return undefined;
    }
    const observer = new window.IntersectionObserver((entries) => {
      const visible = entries.some((entry) => entry.isIntersecting);
      setInView(visible);
      if (visible) setSeen(true);
    }, { threshold: 0.25 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [hasClip]);

  // Abspielen nur im Bild und wenn erlaubt; sonst anhalten.
  useEffect(() => {
    const video = videoRef.current;
    if (!mounted || !video) return;
    if (inView && allowed) abspielen(video, () => { setRejected(true); setPlaying(false); });
    else video.pause?.();
  }, [mounted, inView, allowed, quelleSrc]);

  if (!bild) return null;
  const titel = schritt.titel;
  const toggle = () => {
    if (active) {
      setWanted(false);
      videoRef.current?.pause?.();
      return;
    }
    setWanted(true);
    setSeen(true);
    setRejected(false);
    // Direkt in der Geste starten - nach einer Ablehnung ändert der Klick sonst keine Abhängigkeit des Effekts.
    if (videoRef.current) abspielen(videoRef.current, () => { setRejected(true); setPlaying(false); });
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
          data-type={quelle.type}
          onPlay={() => { setPlaying(true); setRejected(false); }}
          onPause={() => setPlaying(false)}
          onError={() => { setFailed((rows) => [...rows, quelle.src]); setPlaying(false); }}
          className="block h-auto max-w-full rounded-sm border border-white/10 bg-[#0F0F10]"
        />
      ) : (
        <img src={bild.src} width={bild.width} height={bild.height} alt={`Bildschirmfoto: ${titel}`} loading="lazy" decoding="async"
          data-testid={`help-step-image-${schritt.id}`}
          className="block h-auto max-w-full rounded-sm border border-white/10 bg-[#0F0F10]" />
      )}
      {hasClip ? (
        <button type="button" onClick={toggle} data-testid={`help-step-clip-toggle-${schritt.id}`}
          aria-label={active ? `Animation „${titel}“ anhalten` : `Animation „${titel}“ abspielen`}
          className="absolute bottom-2 right-2 inline-flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-sm border border-white/15 bg-black/75 px-3 tls-type-label text-white transition-colors duration-150 hover:border-[#29B6E8] hover:text-[#29B6E8] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#29B6E8]">
          {active ? <Pause className="h-4 w-4" aria-hidden="true" /> : <Play className="h-4 w-4" aria-hidden="true" />}
          {active ? null : <span aria-hidden="true">Abspielen</span>}
        </button>
      ) : null}
    </figure>
  );
}
