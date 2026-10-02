// Die Spur im Schnee (W5 #731): einmal am Tag, wenn jemand bis zur Fußzeile scrollt, läuft eine unsichtbare Person
// über die Schneehaube auf der Oberkante des Footers - Schritt für Schritt erscheinen kleine Dellen in der
// Schneelinie, ein paar Krümel stauben auf; nach einer Weile rieselt der Schnee wieder zu. Keine Figur, keine
// Comicspur - die Hauben sind von der Seite gezeichnet, also sind es Dellen im Profil. Reine Rechnung.

export const TRACKS_KEY = "tls-snow-tracks";
export const TRACK_STEP_PX = 24;
export const TRACK_STEP_MS = 420;
export const TRACK_REST_MS = 20000;
export const TRACK_FILL_MS = 4000;
export const TRACK_MIN_RUN = 160;
export const MAX_STEPS = 16;
const MARGIN = 14;
const DENT_WIDTH = 7;

const round = (value) => Math.round(value * 100) / 100;

/**
 * Die Schritte über ein freies Stück der Haube (Breite `width`, Dicke `thickness`): von links oder rechts, im Abstand
 * eines Schritts, abwechselnd etwas tiefer (linker und rechter Fuß). `at` ist der Zeitpunkt des Schritts in ms.
 */
export function trackSteps({ width, thickness, fromLeft = true }) {
  // Die Haube läuft an beiden Enden dünn aus (caps.js) - die Spur beginnt dort, wo der Schnee voll ist.
  const start = Math.max(MARGIN, Math.round(width * 0.2));
  const count = Math.max(0, Math.min(MAX_STEPS, Math.floor((width - start - MARGIN) / TRACK_STEP_PX) + 1));
  return Array.from({ length: count }, (_, index) => {
    const offset = start + index * TRACK_STEP_PX;
    return { x: round(fromLeft ? offset : width - offset), depth: round(thickness * (index % 2 === 0 ? 0.55 : 0.68)), width: DENT_WIDTH, at: index * TRACK_STEP_MS };
  });
}

/** Wie lange die ganze Spur dauert: Schritte, Ruhe, Zurieseln. */
export function tracksDuration(steps) {
  return steps.length ? (steps.length - 1) * TRACK_STEP_MS + TRACK_REST_MS + TRACK_FILL_MS : 0;
}

/** Die Dellen zum Zeitpunkt `elapsed` (ms seit dem ersten Schritt): erscheinen mit ihrem Schritt, rieseln am Ende zu. */
export function dentsAt(steps, elapsed) {
  if (!steps.length) return [];
  const fillStart = (steps.length - 1) * TRACK_STEP_MS + TRACK_REST_MS;
  const fill = elapsed <= fillStart ? 1 : Math.max(0, 1 - (elapsed - fillStart) / TRACK_FILL_MS);
  return steps.filter((step) => elapsed >= step.at && fill > 0).map((step) => ({ x: step.x, width: step.width, depth: round(step.depth * fill), fresh: elapsed - step.at < 700 }));
}

function localDay(now) {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Lief die Spur heute auf diesem Gerät schon? Ohne Speicher: nein. */
export function tracksToday(storage, now = new Date()) {
  try {
    return Boolean(storage) && storage.getItem(TRACKS_KEY) === localDay(now);
  } catch {
    return false;
  }
}

export function markTracks(storage, now = new Date()) {
  try {
    storage?.setItem(TRACKS_KEY, localDay(now));
  } catch {
    // Ohne Speicher läuft sie beim nächsten Besuch noch einmal - verschmerzbar.
  }
}
