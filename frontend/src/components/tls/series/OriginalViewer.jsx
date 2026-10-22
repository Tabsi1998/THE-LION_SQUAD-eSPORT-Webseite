import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronLeft, ChevronRight, ExternalLink, Images, X } from "lucide-react";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import { motionAllowed } from "@/lib/motion";
import { originalLabel, originalSrc, originalSrcSet, sourceLink } from "@/lib/referenceOriginals";
import "./originals.css";

// „Original ansehen“ (#1933): die Bilder des Veranstalters zu einem Termin im Vollbild. Wischen (am Handy folgt das Bild
// dem Finger, ein kurzer Schwung reicht), Pfeiltasten und Knöpfe blättern, Escape oder „Schließen“ schließt, der Fokus
// bleibt in der Ansicht und kehrt danach zum Knopf zurück. Die Leiste unten zeigt alle Bilder als Vorschau.

const SWIPE_DISTANCE = 56; // Pixel
const SWIPE_VELOCITY = 0.11; // Pixel je Millisekunde - ein Schwung blättert auch ohne weiten Weg

function labelOf(item) {
  return item.label || originalLabel(item);
}

/** Vollbild mit allen Bildern; `start`: das zuerst gezeigte. */
export function OriginalViewer({ items, start = 0, title = "", onClose }) {
  const [index, setIndex] = useState(() => Math.min(Math.max(start, 0), items.length - 1));
  const container = useModalBehavior(true, onClose);
  const stage = useRef(null);
  const drag = useRef(null);
  const count = items.length;
  const item = items[index];
  const go = useCallback((step) => setIndex((current) => (current + step + count) % count), [count]);

  useEffect(() => {
    const onKey = (event) => {
      if (count < 2) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); go(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); go(1); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count, go]);

  // Die Seite darunter scrollt nicht mit, solange die Ansicht offen ist.
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = previous; };
  }, []);

  const move = (offset) => {
    if (stage.current) stage.current.style.transform = offset ? `translateX(${offset}px)` : "";
  };
  const onPointerDown = (event) => {
    if (count < 2 || drag.current || (event.pointerType === "mouse" && event.button !== 0)) return;
    drag.current = { id: event.pointerId, x: event.clientX, y: event.clientY, at: event.timeStamp || Date.now() };
    stage.current?.setPointerCapture?.(event.pointerId);
    stage.current?.classList.add("is-dragging");
  };
  const onPointerMove = (event) => {
    const now = drag.current;
    if (!now || now.id !== event.pointerId) return;
    const dx = event.clientX - now.x;
    if (Math.abs(dx) < Math.abs(event.clientY - now.y)) return;
    // Folgt dem Finger, leicht gebremst - mehr als eine Bildbreite gibt es nicht.
    if (motionAllowed()) move(dx * 0.85);
  };
  const endDrag = (event) => {
    const now = drag.current;
    if (!now || now.id !== event.pointerId) return;
    drag.current = null;
    stage.current?.classList.remove("is-dragging");
    move(0);
    const dx = event.clientX - now.x;
    const dy = event.clientY - now.y;
    const elapsed = Math.max(1, (event.timeStamp || Date.now()) - now.at);
    if (Math.abs(dx) <= Math.abs(dy)) return;
    if (Math.abs(dx) >= SWIPE_DISTANCE || (Math.abs(dx) > 12 && Math.abs(dx) / elapsed > SWIPE_VELOCITY)) go(dx < 0 ? 1 : -1);
  };

  if (!item) return null;
  const source = sourceLink(item);
  return (
    <div ref={container} role="dialog" aria-modal="true" aria-label={title ? `Original-Bilder: ${title}` : "Original-Bilder"}
      className="tls-lightbox tls-original-viewer fixed inset-0 z-50 flex flex-col bg-black/[0.97]" data-testid="original-viewer">
      <div className="absolute inset-0" onClick={onClose} aria-hidden="true" data-testid="original-viewer-backdrop" />
      <header className="relative z-10 flex items-center gap-3 px-4 pt-[max(12px,env(safe-area-inset-top))] pb-2 sm:px-6">
        <div className="min-w-0 flex-1">
          {title && <p className="truncate text-xs text-white/55">{title}</p>}
          <p className="truncate text-sm font-bold text-white" data-testid="original-viewer-label">{labelOf(item)}</p>
        </div>
        {count > 1 && <span className="shrink-0 text-xs tabular-nums text-white/60" data-testid="original-viewer-count">{index + 1} / {count}</span>}
        <button type="button" onClick={onClose} className="tls-original-viewer__icon" aria-label="Schließen" data-testid="original-viewer-close">
          <X className="h-6 w-6" aria-hidden="true" />
        </button>
      </header>

      <div className="relative z-0 flex min-h-0 flex-1 items-center justify-center px-2 sm:px-16">
        {count > 1 && (
          <button type="button" onClick={() => go(-1)} className="tls-original-viewer__icon tls-original-viewer__nav left-2 sm:left-4" aria-label="Voriges Bild" data-testid="original-viewer-prev">
            <ChevronLeft className="h-7 w-7" aria-hidden="true" />
          </button>
        )}
        <div ref={stage} className="tls-original-viewer__stage relative flex h-full w-full items-center justify-center"
          onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}
          data-testid="original-viewer-stage">
          <img key={item.id} src={originalSrc(item.url, item.width > 1600 ? 1600 : undefined)} srcSet={originalSrcSet(item)}
            sizes="(min-width: 640px) 90vw, 100vw" width={item.width || undefined} height={item.height || undefined}
            alt={`Original des Veranstalters: ${labelOf(item)}`} draggable={false} decoding="async"
            className="tls-original-viewer__image max-h-full max-w-full select-none object-contain" data-testid="original-viewer-image" />
        </div>
        {count > 1 && (
          <button type="button" onClick={() => go(1)} className="tls-original-viewer__icon tls-original-viewer__nav right-2 sm:right-4" aria-label="Nächstes Bild" data-testid="original-viewer-next">
            <ChevronRight className="h-7 w-7" aria-hidden="true" />
          </button>
        )}
      </div>

      <footer className="relative z-10 flex flex-col gap-3 px-4 pt-2 pb-[max(14px,env(safe-area-inset-bottom))] sm:px-6">
        <p className="sr-only" aria-live="polite" data-testid="original-viewer-status">{`Bild ${index + 1} von ${count}: ${labelOf(item)}`}</p>
        {source && (
          <a href={source} target="_blank" rel="noopener noreferrer nofollow" className="inline-flex items-center gap-1.5 self-center text-xs text-[#29B6E8] underline-offset-4 hover:underline" data-testid="original-viewer-source">
            Quelle beim Veranstalter <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        )}
        {count > 1 && (
          <ol className="tls-swipe tls-original-viewer__thumbs flex gap-2 self-center" aria-label="Alle Bilder" data-testid="original-viewer-thumbs">
            {items.map((entry, position) => (
              <li key={entry.id} className="shrink-0">
                <button type="button" onClick={() => setIndex(position)} aria-current={position === index ? "true" : undefined}
                  aria-label={`Bild ${position + 1}: ${labelOf(entry)}`} className="tls-original-viewer__thumb" data-testid="original-viewer-thumb">
                  <img src={originalSrc(entry.url, 160)} width={64} height={40} alt="" loading="lazy" decoding="async" className="h-10 w-16 object-cover" />
                </button>
              </li>
            ))}
          </ol>
        )}
      </footer>
    </div>
  );
}

/** Kleiner Knopf „Original ansehen“ - nur, wenn es öffentliche Bilder gibt. */
export function OriginalsButton({ items, title = "", className = "", testId = "originals-open" }) {
  const [open, setOpen] = useState(false);
  const button = useRef(null);
  if (!items?.length) return null;
  const many = items.length > 1;
  return (
    <>
      <button ref={button} type="button" onClick={() => setOpen(true)} data-testid={testId}
        aria-label={many ? `Original ansehen, ${items.length} Bilder` : "Original ansehen"}
        className={`tls-btn tls-btn--quiet inline-flex items-center gap-1.5 rounded-sm px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider ${className}`}>
        <Images className="h-3.5 w-3.5" aria-hidden="true" />
        Original ansehen
        {many && <span className="tabular-nums text-white/55" aria-hidden="true">{items.length}</span>}
      </button>
      {/* Ins <body>: Karten und Zeilen mit Bewegung (transform) wären sonst der Rahmen des Vollbilds. */}
      {open && createPortal(<OriginalViewer items={items} title={title} onClose={() => setOpen(false)} />, document.body)}
    </>
  );
}
