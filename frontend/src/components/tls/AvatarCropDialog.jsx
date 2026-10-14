import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Check, Minus, Plus, RotateCcw, X } from "lucide-react";
import { toast } from "sonner";
import { useModalBehavior } from "@/hooks/useModalBehavior";
import {
  AVATAR_MAX_ZOOM,
  avatarPreviewBox,
  INITIAL_AVATAR_CROP,
  isSafeBlobUrl,
  panAvatarCrop,
  renderAvatarFile,
  zoomAvatarCrop,
} from "@/lib/avatarCrop";

// Profilbild zuschneiden (#1459): Die Löwen-Rahmen zeigen das Foto rund. Nach der Dateiwahl wählt man hier den
// Ausschnitt - zoomen (Regler, Mausrad, zwei Finger, Plus/Minus) und verschieben (ziehen, Pfeiltasten). Der Ausschnitt
// bleibt immer ganz im Bild, es gibt also nie leere Ränder. „Übernehmen“ schneidet im Browser auf ein Quadrat
// (bis 512 px, WebP) zu; hochgeladen wird über den bestehenden Weg (`/uploads/image`) mit derselben Bildprüfung.
// Bewegung: nichts ist animiert, das Bild folgt direkt Finger, Maus und Tasten („Bewegung reduzieren“ bleibt gewahrt).

const KEY_STEP = 4; // Prozent der Ansicht je Pfeiltaste
const KEY_STEP_LARGE = 16; // mit Umschalt
const ZOOM_STEP = 1.15;

function pct(value) {
  return `${value}%`;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function CropImage({ url, dims, crop, imgRef, onLoad, onError }) {
  const box = dims ? avatarPreviewBox(dims, crop, 100) : null;
  return (
    <img
      ref={imgRef}
      src={url}
      alt=""
      draggable={false}
      onLoad={onLoad}
      onError={onError}
      className={`absolute max-w-none select-none ${box ? "" : "opacity-0"}`}
      style={box ? { left: pct(box.left), top: pct(box.top), width: pct(box.width), height: pct(box.height) } : { left: 0, top: 0, width: "100%" }}
    />
  );
}

export function AvatarCropDialog({ file, busy = false, onCancel, onApply, onLoadError, testId = "avatar-crop" }) {
  const titleId = useId();
  const helpId = useId();
  const zoomId = useId();
  const [url, setUrl] = useState("");
  const [dims, setDims] = useState(null);
  const [crop, setCrop] = useState(INITIAL_AVATAR_CROP);
  const [working, setWorking] = useState(false);
  const imgRef = useRef(null);
  const viewRef = useRef(null);
  const cropRef = useRef(crop);
  const pointers = useRef(new Map());
  const gesture = useRef(null);
  cropRef.current = crop;
  const locked = busy || working;
  const dialogRef = useModalBehavior(true, () => {
    if (!locked) onCancel?.();
  });

  // Der Fokus startet auf dem Ausschnitt (nach dem Hook oben, der sich den vorherigen Fokus merkt).
  useEffect(() => {
    viewRef.current?.focus();
  }, []);

  const loadErrorRef = useRef(onLoadError);
  loadErrorRef.current = onLoadError;

  useEffect(() => {
    if (!file) return undefined;
    const next = URL.createObjectURL(file);
    setDims(null);
    setCrop(INITIAL_AVATAR_CROP);
    // Nur eine echte Blob-Adresse kommt in die Vorschau; alles andere gilt als „Bild nicht ladbar“.
    // `encodeURI` lässt eine echte Blob-Adresse unverändert; ändert es etwas, ist es keine. In die Vorschau geht die
    // codierte Fassung - so ist die Adresse auch für die Code-Analyse geprüft.
    const preview = encodeURI(next);
    if (preview === next && isSafeBlobUrl(preview)) {
      setUrl(preview);
      return () => URL.revokeObjectURL(next);
    }
    URL.revokeObjectURL(next);
    setUrl("");
    loadErrorRef.current?.();
    return undefined;
  }, [file]);

  const update = useCallback((next) => {
    if (!dims) return;
    setCrop((current) => (typeof next === "function" ? next(current) : next));
  }, [dims]);

  const zoomBy = useCallback((factor) => update((current) => zoomAvatarCrop(dims, current, current.zoom * factor)), [dims, update]);

  // Mausrad / Touchpad: als eigener Listener, weil React Mausrad-Ereignisse passiv anhängt (sonst scrollt die Seite mit).
  useEffect(() => {
    const element = viewRef.current;
    if (!element || !dims) return undefined;
    const onWheel = (event) => {
      event.preventDefault();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : 1);
      setCrop((current) => zoomAvatarCrop(dims, current, current.zoom * Math.exp(-delta * 0.0015)));
    };
    element.addEventListener("wheel", onWheel, { passive: false });
    return () => element.removeEventListener("wheel", onWheel);
  }, [dims]);

  const startGesture = () => {
    const points = [...pointers.current.values()];
    if (points.length >= 2) gesture.current = { type: "pinch", distance: Math.max(1, distance(points[0], points[1])), crop: cropRef.current };
    else if (points.length === 1) gesture.current = { type: "pan", x: points[0].x, y: points[0].y, crop: cropRef.current };
    else gesture.current = null;
  };

  const onPointerDown = (event) => {
    if (!dims || locked) return;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    startGesture();
  };

  const onPointerMove = (event) => {
    if (!dims || !pointers.current.has(event.pointerId)) return;
    pointers.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
    const current = gesture.current;
    if (!current) return;
    if (current.type === "pinch") {
      const points = [...pointers.current.values()];
      if (points.length < 2) return;
      setCrop(zoomAvatarCrop(dims, current.crop, current.crop.zoom * (distance(points[0], points[1]) / current.distance)));
      return;
    }
    const width = event.currentTarget.getBoundingClientRect().width;
    setCrop(panAvatarCrop(dims, current.crop, event.clientX - current.x, event.clientY - current.y, width));
  };

  const onPointerEnd = (event) => {
    pointers.current.delete(event.pointerId);
    startGesture();
  };

  const onKeyDown = (event) => {
    if (!dims || locked) return;
    const step = event.shiftKey ? KEY_STEP_LARGE : KEY_STEP;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[event.key]) {
      const [dx, dy] = moves[event.key];
      update((current) => panAvatarCrop(dims, current, dx, dy, 100));
    } else if (event.key === "+" || event.key === "=") {
      zoomBy(ZOOM_STEP);
    } else if (event.key === "-" || event.key === "_") {
      zoomBy(1 / ZOOM_STEP);
    } else if (event.key === "0" || event.key === "Home") {
      update(INITIAL_AVATAR_CROP);
    } else {
      return;
    }
    event.preventDefault();
  };

  const apply = async () => {
    if (!dims || !imgRef.current || locked) return;
    setWorking(true);
    try {
      const cropped = await renderAvatarFile(imgRef.current, dims, cropRef.current, file?.name);
      if (!cropped) {
        toast.error("Zuschneiden klappt in diesem Browser nicht. Versuch es mit einem anderen Browser.");
        return;
      }
      await onApply?.(cropped);
    } finally {
      setWorking(false);
    }
  };

  const zoomPercent = Math.round(crop.zoom * 100);
  return (
    <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm p-4 overflow-y-auto flex items-end sm:items-center justify-center" role="presentation" data-testid={testId}>
      <div
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-md bg-[#121212] border border-white/10 rounded-sm shadow-2xl focus:outline-none"
        data-testid={`${testId}-dialog`}
      >
        <div className="flex items-start justify-between gap-3 p-5 border-b border-white/10">
          <div>
            <h2 id={titleId} className="font-heading text-xl font-black uppercase">Profilbild zuschneiden</h2>
            <p className="mt-1 text-sm text-white/60">So erscheint dein Bild im runden Rahmen.</p>
          </div>
          <button type="button" onClick={onCancel} disabled={locked} aria-label="Abbrechen und schließen" className="p-1 text-white/50 hover:text-white disabled:opacity-40">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- der Ausschnitt ist selbst das Bedienelement: per Tastatur erreichbar (Pfeile, Plus/Minus), beschriftet und beschrieben; einen passenden ARIA-Rollentyp für zweiachsiges Verschieben gibt es nicht */}
          <div
            ref={viewRef}
            role="group"
            // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- Tastaturweg zum Verschieben und Zoomen (siehe oben)
            tabIndex={0}
            aria-roledescription="Bildausschnitt"
            aria-label="Ausschnitt verschieben und zoomen"
            aria-describedby={helpId}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerEnd}
            onPointerCancel={onPointerEnd}
            onKeyDown={onKeyDown}
            className="relative mx-auto w-full max-w-[min(20rem,55vh)] aspect-square overflow-hidden bg-[#0A0A0A] touch-none select-none cursor-grab active:cursor-grabbing rounded-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-[#29B6E8]"
            data-testid={`${testId}-view`}
          >
            {url && (
              <CropImage
                url={url}
                dims={dims}
                crop={crop}
                imgRef={imgRef}
                onLoad={(event) => {
                  const { naturalWidth, naturalHeight } = event.currentTarget;
                  if (naturalWidth && naturalHeight) setDims({ width: naturalWidth, height: naturalHeight });
                  else onLoadError?.();
                }}
                onError={() => onLoadError?.()}
              />
            )}
            {/* Außerhalb des Kreises abgedunkelt: so sieht man, was der runde Rahmen zeigt. */}
            <div aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-full shadow-[0_0_0_9999px_rgba(0,0,0,0.6)] ring-2 ring-white/70" />
            {!dims && (
              <div className="absolute inset-0 flex items-center justify-center text-[10px] uppercase tracking-widest font-bold text-white/45">
                Lade Bild …
              </div>
            )}
          </div>
          <p id={helpId} className="text-center text-xs text-white/50">
            Ziehen zum Verschieben, Mausrad oder zwei Finger zum Zoomen. Mit der Tastatur: Pfeiltasten verschieben,
            Plus und Minus zoomen, 0 setzt zurück.
          </p>

          <div className="flex items-center gap-3">
            <button type="button" onClick={() => zoomBy(1 / ZOOM_STEP)} disabled={!dims || locked || crop.zoom <= 1} aria-label="Verkleinern" className="tls-btn tls-btn--quiet inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm disabled:opacity-40">
              <Minus className="w-4 h-4" />
            </button>
            <label htmlFor={zoomId} className="sr-only">Zoom</label>
            <input
              id={zoomId}
              type="range"
              min="1"
              max={AVATAR_MAX_ZOOM}
              step="0.01"
              value={crop.zoom}
              disabled={!dims || locked}
              aria-valuetext={`${zoomPercent} Prozent`}
              onChange={(event) => update((current) => zoomAvatarCrop(dims, current, Number(event.target.value)))}
              className="flex-1 accent-[#29B6E8]"
              data-testid={`${testId}-zoom`}
            />
            <button type="button" onClick={() => zoomBy(ZOOM_STEP)} disabled={!dims || locked || crop.zoom >= AVATAR_MAX_ZOOM} aria-label="Vergrößern" className="tls-btn tls-btn--quiet inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm disabled:opacity-40">
              <Plus className="w-4 h-4" />
            </button>
            <span className="w-12 text-right text-xs tabular-nums text-white/50" aria-hidden="true">{zoomPercent}%</span>
          </div>

          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3" aria-hidden="true">
              {/* Klein, wie in Listen und neben Kommentaren. */}
              <div className="relative w-10 h-10 rounded-full overflow-hidden bg-[#0A0A0A] border border-white/15">
                {url && dims && <CropImage url={url} dims={dims} crop={crop} />}
              </div>
              <span className="text-[10px] uppercase tracking-widest font-bold text-white/40">Klein</span>
            </div>
            <button type="button" onClick={() => update(INITIAL_AVATAR_CROP)} disabled={!dims || locked} className="tls-btn tls-btn--quiet inline-flex min-h-11 items-center gap-2 px-3 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-40">
              <RotateCcw className="w-3.5 h-3.5" /> Zurücksetzen
            </button>
          </div>
        </div>

        <div className="p-5 border-t border-white/10 flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button type="button" onClick={onCancel} disabled={locked} className="tls-btn tls-btn--quiet min-h-11 px-4 py-2 rounded-sm text-xs font-bold uppercase tracking-wider disabled:opacity-50" data-testid={`${testId}-cancel`}>
            Abbrechen
          </button>
          <button type="button" onClick={apply} disabled={!dims || locked} className="tls-btn tls-btn--primary inline-flex min-h-11 items-center justify-center gap-2 px-5 py-2 rounded-sm text-xs font-black uppercase tracking-wider disabled:opacity-50" data-testid={`${testId}-apply`}>
            <Check className="w-4 h-4" /> {locked ? "Lädt hoch …" : "Übernehmen"}
          </button>
        </div>
      </div>
    </div>
  );
}
