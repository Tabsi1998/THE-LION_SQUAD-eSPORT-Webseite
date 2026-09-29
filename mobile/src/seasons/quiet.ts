// Ruhezonen in der App (A3, #717 - wie H10 im Web): die App hat kein DOM zum Abfragen, also melden sich Dialoge,
// Sheets und geschützte Bereiche selbst. Offene Overlays verdrängen Deko und halten das Budget an; Rechtecke in
// Fensterkoordinaten (Formulare, Tabellen, kritische Knöpfe) sperren Plätze. Reine Logik mit Abo, ohne React -
// die Haken dazu stehen in anchors.tsx.

export type QuietRect = { x: number; y: number; width: number; height: number };
type Listener = (state: QuietState) => void;
export type QuietState = { overlays: string[]; zones: Record<string, QuietRect> };

const state: QuietState = { overlays: [], zones: {} };
const listeners = new Set<Listener>();

function emit() {
  // Jeder Zuhörer bekommt den aktuellen Stand - ein Zuhörer darf selbst ändern (die Bühne teilt beim Anmelden zu),
  // die Nachfolger sehen dann schon das Ergebnis statt eines veralteten Schnappschusses.
  listeners.forEach((listener) => listener(quietSnapshot()));
}

export function quietSnapshot(): QuietState {
  return { overlays: [...state.overlays], zones: { ...state.zones } };
}

/** Ein Dialog oder Sheet ist offen (oder wieder zu). */
export function setOverlay(id: string, open: boolean) {
  const has = state.overlays.includes(id);
  if (open && !has) state.overlays.push(id);
  else if (!open && has) state.overlays = state.overlays.filter((entry) => entry !== id);
  else return;
  emit();
}

export function anyOverlayOpen(): boolean {
  return state.overlays.length > 0;
}

/** Ein geschützter Bereich meldet sein Rechteck (Fensterkoordinaten); `null` nimmt es zurück. */
export function setQuietZone(id: string, rect: QuietRect | null) {
  if (rect) state.zones[id] = rect;
  else if (id in state.zones) delete state.zones[id];
  else return;
  emit();
}

export function quietZones(): QuietRect[] {
  return Object.values(state.zones);
}

/** Liegt der Fensterpunkt in einer Ruhezone (mit Rand)? */
export function pointInQuiet(point: { x: number; y: number }, zones: QuietRect[] = quietZones(), padding = 8): boolean {
  return zones.some((zone) => point.x >= zone.x - padding && point.x <= zone.x + zone.width + padding && point.y >= zone.y - padding && point.y <= zone.y + zone.height + padding);
}

/** Schneidet das Rechteck eine Ruhezone? */
export function rectInQuiet(rect: QuietRect, zones: QuietRect[] = quietZones(), padding = 0): boolean {
  return zones.some((zone) => rect.x < zone.x + zone.width + padding && rect.x + rect.width > zone.x - padding && rect.y < zone.y + zone.height + padding && rect.y + rect.height > zone.y - padding);
}

export function subscribeQuiet(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Nur für Tests. */
export function resetQuiet() {
  state.overlays = [];
  state.zones = {};
  emit();
}
