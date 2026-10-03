import { useEffect, useState } from "react";
import type { EggSpot } from "./placement";

// Die Eier des Screens, der gerade zu sehen ist (#647): die Bühne lädt sie und verteilt sie auf die Karten, jede
// Karte zeigt ihre Eier (`useHuntSpots`). Reine Daten mit Abo, ohne Darstellung.

type HuntState = { screen: string; route: string | null; spots: EggSpot[]; guest: boolean; total: number };
type Listener = () => void;

let state: HuntState = { screen: "", route: null, spots: [], guest: true, total: 0 };
const listeners = new Set<Listener>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function huntState(): HuntState {
  return state;
}

export function setHuntSpots(next: HuntState): void {
  state = next;
  emit();
}

/** Ein gefundenes Ei verschwindet von seiner Karte. */
export function removeHuntEgg(eggNo: number): void {
  const spots = state.spots.filter((spot) => spot.egg.egg_no !== eggNo);
  if (spots.length === state.spots.length) return;
  state = { ...state, spots };
  emit();
}

/** Ein neuer Schlüssel für ein Ei (nach einem abgelaufenen) - es bleibt an seinem Platz. */
export function updateHuntEgg(eggNo: number, token: string): void {
  state = { ...state, spots: state.spots.map((spot) => (spot.egg.egg_no === eggNo ? { ...spot, egg: { ...spot.egg, token } } : spot)) };
  emit();
}

export function clearHunt(): void {
  if (!state.spots.length && !state.route) return;
  state = { screen: "", route: null, spots: [], guest: state.guest, total: state.total };
  emit();
}

export function subscribeHunt(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function sameSpots(a: EggSpot[], b: EggSpot[]): boolean {
  return a.length === b.length && a.every((spot, i) => spot.egg.egg_no === b[i].egg.egg_no && spot.corner === b[i].corner && spot.egg.token === b[i].egg.token);
}

/** Die Eier einer Karte - neu nur, wenn sich für diese Karte etwas ändert. */
export function useHuntSpots(perchId: string): EggSpot[] {
  const [spots, setSpots] = useState<EggSpot[]>(() => state.spots.filter((spot) => spot.perchId === perchId));
  useEffect(() => {
    const update = () => setSpots((current) => {
      const next = state.spots.filter((spot) => spot.perchId === perchId);
      return sameSpots(current, next) ? current : next;
    });
    update();
    return subscribeHunt(update);
  }, [perchId]);
  return spots;
}
