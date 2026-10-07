// Die Kamera über dem Turnierbaum-TV (#1115): Der Baum liegt auf einer festen Bühne (gebaut wie für 1920×1080, damit er
// auf jedem Bildschirm gleich aussieht); die Kamera verschiebt und vergrößert nur diese Bühne. Passt der ganze Baum so,
// dass Namen die Mindestgröße halten, steht er still. Sonst fährt die Kamera ruhig von Ausschnitt zu Ausschnitt und bleibt
// am längsten dort, wo gerade gespielt wird. Alle Maße in Bühnen-Punkten; `viewport` ist der sichtbare Bereich bei
// Zoom 1, eine Ansicht `{ x, y, zoom }` ist die linke obere Ecke des Ausschnitts und die Vergrößerung.

export const CAMERA = Object.freeze({
  moveMs: 2200,       // Fahrt von Halt zu Halt
  holdMs: 7000,       // Halt ohne laufendes Spiel
  currentHoldMs: 10000, // Halt mit der Runde, die als Nächstes dran ist
  liveHoldMs: 14000,  // Halt mit einem laufenden Spiel - am längsten
  overlap: 0.14,      // so viel überlappen benachbarte Ausschnitte
  maxZoom: 1.35,      // kleine Bäume werden größer, aber nicht riesig
  focusFill: 0.62,    // beim Hinzoomen füllt das Ziel gut die Hälfte des Bilds
  focusMaxZoom: 1.6,
});

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * Passt der ganze Baum? Der Zoom, bei dem alles ins Bild passt (höchstens `maxZoom`), und ob die Schrift dabei die
 * Untergrenze hält (`minZoom` = kleinster Zoom, bei dem Namen und Nebensachen noch groß genug sind).
 */
export function fitZoom(content, viewport, { minZoom = 1, maxZoom = CAMERA.maxZoom } = {}) {
  if (!content?.w || !content?.h || !viewport?.w || !viewport?.h) return { fits: true, zoom: 1 };
  const zoom = Math.min(viewport.w / content.w, viewport.h / content.h, maxZoom);
  return { fits: zoom >= minZoom - 1e-6, zoom };
}

/** Der Ausschnitt in der Mitte - ein kleiner Baum steht so mittig im Bild. */
export function centeredView(content, viewport, zoom) {
  return { x: (content.w - viewport.w / zoom) / 2, y: (content.h - viewport.h / zoom) / 2, zoom };
}

/** Hält einen Ausschnitt im Baum: nie über den Rand hinaus; ist der Baum schmaler als das Bild, steht er mittig. */
export function clampView(view, content, viewport) {
  const w = viewport.w / view.zoom;
  const h = viewport.h / view.zoom;
  const x = content.w <= w ? (content.w - w) / 2 : clamp(view.x, 0, content.w - w);
  const y = content.h <= h ? (content.h - h) / 2 : clamp(view.y, 0, content.h - h);
  return { x, y, zoom: view.zoom };
}

/** Der Ausschnitt, der ein Rechteck (eine Karte, eine Runde) groß zeigt - für den Zoom beim Start eines Spiels. */
export function viewForRect(rect, content, viewport, { minZoom = 1, maxZoom = CAMERA.focusMaxZoom, fill = CAMERA.focusFill } = {}) {
  const zoom = clamp(Math.min((viewport.w * fill) / Math.max(1, rect.w), (viewport.h * fill) / Math.max(1, rect.h)), minZoom, Math.max(minZoom, maxZoom));
  const w = viewport.w / zoom;
  const h = viewport.h / zoom;
  return clampView({ x: rect.x + rect.w / 2 - w / 2, y: rect.y + rect.h / 2 - h / 2, zoom }, content, viewport);
}

/** Passt ein Rechteck bei diesem Zoom ganz ins Bild? */
export function rectFits(rect, viewport, zoom) {
  return rect.w <= viewport.w / zoom + 0.5 && rect.h <= viewport.h / zoom + 0.5;
}

/** Das Rechteck um mehrere Rechtecke. */
export function unionRect(rects = []) {
  const list = rects.filter(Boolean);
  if (!list.length) return null;
  const x = Math.min(...list.map((rect) => rect.x));
  const y = Math.min(...list.map((rect) => rect.y));
  return { x, y, w: Math.max(...list.map((rect) => rect.x + rect.w)) - x, h: Math.max(...list.map((rect) => rect.y + rect.h)) - y };
}

function visibleShare(box, frame) {
  const w = Math.min(box.x + box.w, frame.x + frame.w) - Math.max(box.x, frame.x);
  const h = Math.min(box.y + box.h, frame.y + frame.h) - Math.max(box.y, frame.y);
  if (w <= 0 || h <= 0 || !box.w || !box.h) return 0;
  return (w * h) / (box.w * box.h);
}

function positions(total, size, overlap) {
  if (total <= size) return [(total - size) / 2];
  const step = size * (1 - overlap);
  const count = Math.ceil((total - size) / step) + 1;
  return Array.from({ length: count }, (_, index) => ((total - size) * index) / (count - 1));
}

/**
 * Die Halte der Kamera über einem großen Baum: Ausschnitte in einem Raster, die sich etwas überlappen, in Schlangenlinie
 * (erste Reihe links nach rechts, zweite rechts nach links …) - so springt die Kamera nie quer über den Baum. Ausschnitte
 * ohne Karte fallen weg. `boxes` sind die Karten `{ x, y, w, h, live, current }`: Ein Halt mit einem laufenden Spiel
 * bleibt am längsten stehen, einer mit der Runde, die als Nächstes dran ist, länger als die übrigen.
 */
export function cameraStops({ content, viewport, zoom, boxes = [], overlap = CAMERA.overlap, holdMs = CAMERA.holdMs, currentHoldMs = CAMERA.currentHoldMs, liveHoldMs = CAMERA.liveHoldMs }) {
  const w = viewport.w / zoom;
  const h = viewport.h / zoom;
  const xs = positions(content.w, w, overlap);
  const ys = positions(content.h, h, overlap);
  const stops = [];
  ys.forEach((y, row) => {
    for (const x of row % 2 === 0 ? xs : [...xs].reverse()) {
      let frame = { x, y, w, h };
      // Eine Karte zählt für einen Halt, wenn sie zum größten Teil im Bild ist.
      let shown = boxes.filter((box) => visibleShare(box, frame) >= 0.6);
      if (!shown.length) continue;
      // Ein laufendes Spiel steht beim Halt ganz im Bild: der Ausschnitt rückt so wenig wie nötig nach.
      const liveBox = unionRect(shown.filter((box) => box.live));
      if (liveBox && liveBox.w <= w && liveBox.h <= h) {
        const nx = clamp(clamp(frame.x, liveBox.x + liveBox.w - w, liveBox.x), Math.min(0, content.w - w), Math.max(0, content.w - w));
        const ny = clamp(clamp(frame.y, liveBox.y + liveBox.h - h, liveBox.y), Math.min(0, content.h - h), Math.max(0, content.h - h));
        frame = { x: nx, y: ny, w, h };
        shown = boxes.filter((box) => visibleShare(box, frame) >= 0.6);
      }
      const live = shown.some((box) => box.live);
      const current = !live && shown.some((box) => box.current);
      stops.push({ x: frame.x, y: frame.y, zoom, live, current, holdMs: live ? liveHoldMs : current ? currentHoldMs : holdMs, cards: shown.length });
    }
  });
  if (!stops.length) stops.push({ ...centeredView(content, viewport, zoom), live: false, current: false, holdMs, cards: 0 });
  return stops;
}

/** Welcher Halt dem gerade gezeigten Ausschnitt am nächsten liegt - damit neue Daten die Kamera nicht springen lassen. */
export function nearestStop(stops = [], view) {
  if (!stops.length || !view) return 0;
  let best = 0;
  let bestDistance = Infinity;
  stops.forEach((stop, index) => {
    const distance = Math.hypot(stop.x - view.x, stop.y - view.y) + Math.abs(Math.log((stop.zoom || 1) / (view.zoom || 1))) * 1000;
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  });
  return best;
}

/** Sanfter Verlauf: langsam los, langsam an. */
export function easeInOut(t) {
  const value = clamp(t, 0, 1);
  return value < 0.5 ? 4 * value * value * value : 1 - ((-2 * value + 2) ** 3) / 2;
}

/**
 * Ein Zwischenstand der Fahrt von `from` nach `to` (Anteil `t`): Die Mitte des Ausschnitts wandert gerade, der Zoom
 * ändert sich gleichmäßig (logarithmisch) - so wirkt Hin- und Wegzoomen ruhig.
 */
export function viewBetween(from, to, t, viewport) {
  const e = easeInOut(t);
  const zoom = Math.exp(Math.log(from.zoom) + (Math.log(to.zoom) - Math.log(from.zoom)) * e);
  const centerFrom = { x: from.x + viewport.w / from.zoom / 2, y: from.y + viewport.h / from.zoom / 2 };
  const centerTo = { x: to.x + viewport.w / to.zoom / 2, y: to.y + viewport.h / to.zoom / 2 };
  const cx = centerFrom.x + (centerTo.x - centerFrom.x) * e;
  const cy = centerFrom.y + (centerTo.y - centerFrom.y) * e;
  return { x: cx - viewport.w / zoom / 2, y: cy - viewport.h / zoom / 2, zoom };
}

/** Die CSS-Verschiebung der Bühne für eine Ansicht; `base` = Bildschirm-Punkte je Bühnen-Punkt bei Zoom 1. */
export function stageTransform(view, base) {
  const scale = base * view.zoom;
  const round = (value) => Math.round(value * 100) / 100;
  return `translate(${round(-view.x * scale)}px, ${round(-view.y * scale)}px) scale(${Math.round(scale * 10000) / 10000})`;
}
