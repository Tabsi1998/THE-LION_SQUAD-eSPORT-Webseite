// Löwen-Rang Teil 3 (#1456): der Aufstiegs-Moment. Beim Level-Aufstieg zeigt der Rahmen seine Signatur am stärksten:
// - Level im Rang: die nächste Raute springt auf, ein Glanz läuft durch, dazu ein kleiner Effekt der Signatur.
// - Rangwechsel: der alte Rahmen blitzt weg, der neue rastet ein, und der große Moment des neuen Rangs läuft.
// Reine Rechnung ohne DOM, damit die Auswahl testbar bleibt; die App rechnet dasselbe (mobile/src/lib/loewenAufstieg.ts).
import { rankInfo } from "./loewenRang";

/**
 * Zeitplan (ms): `hold` - erst steht der Rahmen kurz still, bis die Zeremonie-Karte eingeflogen ist; dann blitzt der alte
 * Rahmen weg (`out`) und der neue rastet ein (`in`). Beim Level im Rang kommt der Moment nach `hold`.
 */
export const ASCENT_TIMING = Object.freeze({ hold: 550, out: 240, in: 600 });

/** Wann der Signatur-Moment startet (Sekunden ab Beginn): beim Rangwechsel erst, wenn der alte Rahmen weg ist. */
export function burstDelay(kind) {
  return (ASCENT_TIMING.hold + (kind === "rank" ? ASCENT_TIMING.out : 100)) / 1000;
}

/**
 * Was der große Moment je Rang zeigt, in der Reihenfolge der Ränge (dieselbe wie SIGNATURE_FX in loewenSignatur.js -
 * hier ohne Import, damit die Zeremonie die Signatur-Tabellen nicht ins Haupt-Bundle zieht; ein Test prüft die Reihenfolge).
 */
export const ASCENT_BURSTS = Object.freeze({
  spark: "Funkenregen aus der Pfote",
  paw: "Pfoten-Kranz",
  ember: "Glut-Ausbruch",
  hunt: "Krallen-Dreifachhieb",
  frost: "Frost-Kranz",
  gold: "Goldstaub saugt sich in den Edelstein und explodiert",
  fire: "Feuerkranz",
  roar: "Schallwellen-Salve",
  feather: "Federexplosion",
  lava: "Vulkan",
  sun: "Sonnenblitz",
  storm: "doppelter Blitzeinschlag mit Druckwelle",
});
export const ASCENT_FX = Object.freeze(Object.keys(ASCENT_BURSTS));

/**
 * Welcher Moment zu einem Level-Aufstieg gehört - oder null, wenn es keinen gibt.
 * `levelUp` ist das Paket aus der Zeremonie (`level`, `previous`, `prestigeGained`). Ein Prestige (wieder Level 1 mit
 * neuem Stern) hat seinen eigenen Ablauf mit Sternen und keinen Rahmen-Moment. `reduced` („Bewegung reduzieren“ oder
 * „Zeremonien dezent“) lässt nur Ein- und Ausblenden übrig: keine Partikel, kein Springen, kein Glanz-Lauf.
 */
export function ascentMoment(levelUp, { reduced = false } = {}) {
  if (!levelUp || levelUp.prestigeGained) return null;
  const level = Math.floor(Number(levelUp.level) || 0);
  const previous = Math.floor(Number(levelUp.previous ?? level - 1) || 0);
  if (level < 1 || previous < 1 || level <= previous) return null;
  const from = rankInfo(previous);
  const to = rankInfo(level);
  const kind = to.rank > from.rank ? "rank" : "level";
  const fx = ASCENT_FX[to.rank - 1];
  // Rauten, die neu aufspringen: im selben Rang ab der letzten gefüllten, nach einem Rangwechsel alle gefüllten.
  const firstNew = kind === "rank" ? 0 : from.filled;
  const pops = Array.from({ length: Math.max(0, to.filled - firstNew) }, (_, i) => firstNew + i);
  return {
    id: `${previous}>${level}`,
    kind,
    level: to.level,
    previous: from.level,
    from,
    to,
    fx,
    burst: ASCENT_BURSTS[fx],
    // Der große Moment beim Rangwechsel und beim letzten Level (60); sonst der kleine.
    strong: kind === "rank" || to.max,
    pops: reduced ? [] : pops,
    particles: !reduced,
    reduced: Boolean(reduced),
  };
}
