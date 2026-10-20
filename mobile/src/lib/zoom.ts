// Zoomen in der Galerie (#999): die Rechnung hinter Zwei-Finger-Zoom und Verschieben, getrennt von den Gesten, damit
// sie auf Android und iOS gleich ist und sich ohne Gerät prüfen lässt. Dieselben Regeln wie im Web (#1250): Zoom je
// Bild, Wischen blättert nur ohne Zoom.

export const MIN_ZOOM = 1;
export const MAX_ZOOM = 4;
/** Unter dieser Vergrößerung gilt ein Bild als nicht gezoomt (und springt beim Loslassen zurück). */
export const ZOOM_SNAP = 1.05;

export type ZoomState = { scale: number; x: number; y: number };

export const ZOOM_RESET: ZoomState = { scale: 1, x: 0, y: 0 };

export function clampScale(scale: number): number {
  if (!Number.isFinite(scale)) return MIN_ZOOM;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale));
}

/** Abstand zweier Finger. */
export function touchDistance(a: { pageX: number; pageY: number }, b: { pageX: number; pageY: number }): number {
  return Math.hypot(a.pageX - b.pageX, a.pageY - b.pageY);
}

/** Neue Vergrößerung aus dem Fingerabstand am Anfang und jetzt. */
export function pinchScale(startScale: number, startDistance: number, distance: number): number {
  if (!startDistance || !distance) return clampScale(startScale);
  return clampScale(startScale * (distance / startDistance));
}

/** So weit lässt sich ein vergrößertes Bild verschieben, ohne dass Rand ins Bild rutscht. */
export function panLimits(scale: number, width: number, height: number): { x: number; y: number } {
  const factor = Math.max(0, clampScale(scale) - 1) / 2;
  return { x: width * factor, y: height * factor };
}

function clampAxis(value: number, limit: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(limit, Math.max(-limit, value));
}

/** Verschiebung in die Grenzen holen (bei Vergrößerung 1 immer mittig). */
export function clampPan(state: ZoomState, width: number, height: number): ZoomState {
  const scale = clampScale(state.scale);
  const limits = panLimits(scale, width, height);
  return { scale, x: clampAxis(state.x, limits.x), y: clampAxis(state.y, limits.y) };
}

/** Nach dem Loslassen: fast nicht gezoomt heißt zurück auf 1, sonst in die Grenzen. */
export function settleZoom(state: ZoomState, width: number, height: number): ZoomState {
  if (state.scale < ZOOM_SNAP) return ZOOM_RESET;
  return clampPan(state, width, height);
}

export function isZoomed(state: ZoomState): boolean {
  return state.scale >= ZOOM_SNAP;
}
