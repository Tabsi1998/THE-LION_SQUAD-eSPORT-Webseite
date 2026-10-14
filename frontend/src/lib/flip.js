// FLIP (#1585): Zeilen, die ihren Platz wechseln, gleiten von der alten Stelle an die neue - erst messen (First, Last),
// dann den Weg umkehren (Invert) und mit transform zurück auf null laufen lassen (Play). Hier stehen nur die Rechnungen;
// die Bewegung macht die Seite mit element.animate().
import { participantKey } from "./fastLapEvent";

/** Weg je Zeile: alte Oberkante minus neue - nur für Zeilen, die vorher schon da waren und sich bewegt haben. */
export function flipDeltas(before, after, threshold = 1) {
  const out = new Map();
  if (!before || !after) return out;
  for (const [key, top] of after) {
    if (!before.has(key)) continue;
    const delta = before.get(key) - top;
    if (Math.abs(delta) > threshold) out.set(key, delta);
  }
  return out;
}

/** Wer den Platz gewechselt hat: „up“ oder „down“ je Schlüssel. */
export function rankMoves(before, after) {
  const out = new Map();
  const old = new Map((before || []).map((entry) => [participantKey(entry), Number(entry.rank)]));
  for (const entry of after || []) {
    const key = participantKey(entry);
    if (!old.has(key)) continue;
    const was = old.get(key);
    const now = Number(entry.rank);
    if (now < was) out.set(key, "up");
    else if (now > was) out.set(key, "down");
  }
  return out;
}
