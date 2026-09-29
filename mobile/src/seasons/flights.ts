// Flüge in der App (A1/A2): eine verscheuchte Fledermaus verlässt ihre Karte und fliegt über die Bühne - die Karte
// weiß nur, wo sie war (Fensterkoordinaten), die Bühne zeichnet den Flug. Reiner Speicher mit Abo, ohne React.

import type { FlightPath } from "./bats";
import type { PerchAssignment } from "./perches";

export type FlightKind = "flee" | "approach" | "hop";
export type Flight = {
  id: number;
  screen: string;
  perchId: string | null;
  from: { x: number; y: number };
  size: number;
  path: FlightPath;
  durationMs: number;
  startedAt: number;
  kind: FlightKind;
  /** Anflug und Umzug landen hier: der Platz wird mit dem Ende des Flugs zugeteilt. */
  landOn?: PerchAssignment | null;
  temperament?: string;
};
type Listener = (flights: Flight[]) => void;
type EndListener = (flight: Flight) => void;
type HopRequest = { perchId: string; screen: string; from: { x: number; y: number }; size: number; temperament: string };
type HopListener = (request: HopRequest) => void;

let flights: Flight[] = [];
let nextId = 1;
const listeners = new Set<Listener>();
const endListeners = new Set<EndListener>();
const hopListeners = new Set<HopListener>();

function emit() {
  listeners.forEach((listener) => listener([...flights]));
}

export function startFlight(flight: Omit<Flight, "id" | "startedAt" | "kind"> & { kind?: FlightKind }, now = Date.now()): Flight {
  const entry: Flight = { kind: "flee", ...flight, id: nextId++, startedAt: now };
  flights = [...flights, entry];
  emit();
  return entry;
}

/** Ein Flug ist zu Ende: wer landen will, wird gemeldet (die Bühne teilt den Platz zu). */
export function endFlight(id: number) {
  const ended = flights.find((flight) => flight.id === id);
  if (!ended) return;
  flights = flights.filter((flight) => flight.id !== id);
  emit();
  endListeners.forEach((listener) => listener(ended));
}

export function subscribeFlightEnd(listener: EndListener): () => void {
  endListeners.add(listener);
  return () => {
    endListeners.delete(listener);
  };
}

/** Eine ruhende Fledermaus will umziehen (A2): die Bühne sucht einen freien Platz und startet den Umzug. */
export function requestHop(request: HopRequest) {
  hopListeners.forEach((listener) => listener(request));
}

export function subscribeHops(listener: HopListener): () => void {
  hopListeners.add(listener);
  return () => {
    hopListeners.delete(listener);
  };
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

export function flightCount(): number {
  return flights.length;
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
