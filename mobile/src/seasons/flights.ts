// Flüge in der App (A1/A2): eine verscheuchte Fledermaus verlässt ihre Karte und fliegt über die Bühne - die Karte
// weiß nur, wo sie war (Fensterkoordinaten), die Bühne zeichnet den Flug. Reiner Speicher mit Abo, ohne React.

import type { FlightPath } from "./bats";

export type Flight = { id: number; screen: string; perchId: string | null; from: { x: number; y: number }; size: number; path: FlightPath; durationMs: number; startedAt: number };
type Listener = (flights: Flight[]) => void;

let flights: Flight[] = [];
let nextId = 1;
const listeners = new Set<Listener>();

function emit() {
  const snapshot = [...flights];
  listeners.forEach((listener) => listener(snapshot));
}

export function startFlight(flight: Omit<Flight, "id" | "startedAt">, now = Date.now()): Flight {
  const entry: Flight = { ...flight, id: nextId++, startedAt: now };
  flights = [...flights, entry];
  emit();
  return entry;
}

export function endFlight(id: number) {
  const before = flights.length;
  flights = flights.filter((flight) => flight.id !== id);
  if (flights.length !== before) emit();
}

export function activeFlights(): Flight[] {
  return [...flights];
}

export function subscribeFlights(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Nur für Tests. */
export function resetFlights() {
  flights = [];
  emit();
}

/** Flucht aus Fensterkoordinaten: erst ein Stück hoch, dann weit weg - meist nach unten aus dem Bild, sonst oben. */
export function fleePath(from: { x: number; y: number }, size: { width: number; height: number }, rng: () => number = Math.random): FlightPath {
  const dir: 1 | -1 = rng() < 0.5 ? -1 : 1;
  const endX = dir > 0 ? size.width + 80 : -80;
  const endY = rng() < 0.6 ? Math.min(size.height - 40, from.y + 220 + rng() * 260) : Math.max(-60, from.y - 120 - rng() * 120);
  return {
    p0: from,
    p1: { x: from.x + (endX - from.x) * 0.25, y: from.y - 90 - rng() * 40 },
    p2: { x: from.x + (endX - from.x) * 0.75, y: endY - 60 },
    p3: { x: endX, y: endY },
    facing: dir,
  };
}
