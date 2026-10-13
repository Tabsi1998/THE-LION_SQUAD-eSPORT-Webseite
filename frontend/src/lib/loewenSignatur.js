// Löwen-Rang Teil 2 (#1455): jeder Rang hat ein eigenes Element, die Signatur. Sie wächst mit jedem Level im Rang:
// Stärke k = (Level - erstes Level) / (letztes Level - erstes Level), also 0 beim ersten und 1 beim letzten Level.
// Beim ersten Level eines Rangs glänzt nur der Rahmen (CSS); ab dem zweiten kommen nach und nach die Ebenen der
// Signatur dazu. Die Werte stammen aus dem Prototyp (lsw-art/vorlage) und gelten nur im Profilkopf.
import { rankInfo } from "./loewenRang";

/** Signatur je Rang (Index = Rang - 1). */
export const SIGNATURE_FX = ["spark", "paw", "ember", "hunt", "frost", "gold", "fire", "roar", "feather", "lava", "sun", "storm"];

/**
 * Ab welcher Stärke k eine Ebene der Signatur dazukommt. Eine Ebene ist an, wenn k >= Schwelle. Alle Schwellen sind
 * größer als 0: Das erste Level eines Rangs zeigt nur den Glanz.
 */
export const SIGNATURE_LAYERS = Object.freeze({
  // Rang 1 (1–4): Staub tanzt, Funken an der Pfote, Funkenschlag
  spark: { dust: 0.01, sparks: 0.6 },
  // Rang 2 (5–9): Pfotenspuren im Kreis, ab 8 in Cyan
  paw: { paws: 0.01, cyan: 0.74 },
  // Rang 3 (10–14): Glut steigt aus dem Wappen, bei 14 glüht der ganze Rahmen
  ember: { embers: 0.01, edge: 0.99 },
  // Rang 4 (15–19): Bronzefunken, ab 17 Krallenhiebe
  hunt: { sparks: 0.01, slash: 0.5 },
  // Rang 5 (20–24): Mondlicht, Frost glitzert, Schnee
  frost: { mist: 0.01, twinkle: 0.25, snow: 0.5 },
  // Rang 6 (25–29): Goldstaub-Wirbel, Funkeln, Goldströme
  gold: { orbit: 0.01, twinkle: 0.74, stream: 0.99 },
  // Rang 7 (30–34): Feuer Orange/Gold, ab 33 Glutfunken
  fire: { flames: 0.01, embers: 0.75 },
  // Rang 8 (35–39): Schallwellen aus dem Maul, ab 38 kräftiger
  roar: { waves: 0.01, quake: 0.74 },
  // Rang 9 (40–44): fallende Lichtfedern, ab 43 auch in Cyan
  feather: { feathers: 0.01, cyan: 0.74 },
  // Rang 10 (45–49): glühende Risse, Rauch, ab 48 Glutregen
  lava: { glow: 0.01, smoke: 0.01, pulse: 0.5, embers: 0.74 },
  // Rang 11 (50–54): Sonnenstrahlen, ab 53 Lichtblitze
  sun: { rays: 0.01, flares: 0.74 },
  // Rang 12 (55–60): 56 kleine Cyan-Flammen, 57 Knistern, 58 Gewitterwolken, 59 Blitze, 60 volles Sturmfeuer
  storm: { flames: 0.01, crackle: 0.35, clouds: 0.55, bolts: 0.75, fury: 0.99 },
});

/** Was Mitglieder je Level sehen (Index = Level im Rang), für Titel und Tests. */
export const SIGNATURE_STEPS = Object.freeze({
  spark: ["Stahl glänzt", "Staub tanzt", "erste Funken an der Pfote", "Funkenschlag"],
  paw: ["Krallenspuren glänzen", "erste Pfotenspur", "Spuren im Kreis", "Spuren in Cyan", "ganze Fährte leuchtet"],
  ember: ["Wappen glänzt", "erste Glut", "Glut steigt auf", "Glutfunken", "Wappen glüht"],
  hunt: ["Bronze glänzt", "Bronzefunken", "erster Krallenhieb", "Hiebe häufiger", "Jagdfieber"],
  frost: ["Mondglanz", "Frost glitzert", "Schnee fällt", "Kälte zieht auf", "Froststurm"],
  gold: ["Goldglanz", "Goldstaub kreist", "dichter Wirbel", "Funkeln auf den Spitzen", "Goldströme steigen auf"],
  fire: ["Glut im Rahmen", "kleine Flammen", "Flammen rundum", "Feuer lodert", "Flammenkranz"],
  roar: ["Maul glüht", "erste Schallwelle", "Wellen häufiger", "Wellen lassen den Rahmen beben", "Brüllen ohne Pause"],
  feather: ["Schwingen glänzen", "eine Feder fällt", "Federregen", "Federn leuchten Cyan", "Federsturm"],
  lava: ["Risse glimmen", "Rauch steigt", "Risse pulsieren", "Glutregen", "Vulkan"],
  sun: ["Sonnenglanz", "Strahlen drehen sich", "Strahlen werden länger", "Lichtblitze", "Sonnenkranz in voller Kraft"],
  storm: ["Krone glänzt", "kleine Cyan-Flammen", "Flammen und Knistern", "Gewitterwolken ziehen auf", "Blitze schlagen ein", "volles Sturmfeuer"],
});

/** Höchstens so viele Partikel gleichzeitig - auch beim vollen Sturmfeuer. */
export const MAX_PARTICLES = 240;
/** Höchstens diese Pixeldichte für die Leinwand: schärfer sieht man Glut und Flammen nicht, es kostet nur Leistung. */
export const MAX_DPR = 1.5;

/** Die Ebenen einer Signatur, die bei Stärke `k` an sind (in der Reihenfolge der Tabelle). */
export function signatureLayers(fx, k) {
  const table = SIGNATURE_LAYERS[fx];
  if (!table) return [];
  return Object.keys(table).filter((name) => k >= table[name]);
}

/**
 * Alles, was der Effekt über ein Level wissen muss: Rang, Signatur `fx`, Stärke `k` (0 … 1), die Ebenen, die an sind,
 * und was Mitglieder bei diesem Level sehen.
 */
export function signatureFor(level) {
  const info = rankInfo(level);
  const fx = SIGNATURE_FX[info.rank - 1];
  const k = info.to > info.from ? (info.level - info.from) / (info.to - info.from) : 1;
  const steps = SIGNATURE_STEPS[fx];
  return { rank: info.rank, key: info.key, name: info.name, level: info.level, fx, k, layers: signatureLayers(fx, k), step: steps[Math.min(steps.length - 1, info.level - info.from)] };
}

/**
 * Läuft ein Effekt? Nur im Profilkopf, nicht mit „Bewegung reduzieren“ und nur, wenn bei diesem Level schon eine
 * Ebene an ist (beim ersten Level eines Rangs glänzt nur der Rahmen).
 */
export function signatureEnabled({ level, variant = "profile", reducedMotion = false }) {
  if (variant !== "profile" || reducedMotion) return false;
  return signatureFor(level).layers.length > 0;
}

/** Die Pixeldichte der Leinwand: die des Geräts, höchstens MAX_DPR. */
export function canvasDpr(devicePixelRatio) {
  const value = Number(devicePixelRatio) || 1;
  return Math.max(1, Math.min(MAX_DPR, value));
}
