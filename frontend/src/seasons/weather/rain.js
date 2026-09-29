// Regen (Wetter-Ebene, #673): wenn es am Vereinsort wirklich regnet, regnet es auch auf der Seite - feine, schräge
// Striche in drei Tiefen (hinten kurz, blass und langsamer; vorne lang, heller und schnell), geneigt nach Wind und
// Böen aus dem Wetter, Menge nach `rain_mm`. Die Tropfen gehören zur Seite (beim Scrollen fährt man an ihnen vorbei),
// und ein Teil der vorderen landet auf den Oberkanten von Karten, Rahmen und Fußzeile mit einem winzigen Spritzer.
// Nie deckender als 0,35, damit Schrift bleibt, wie sie ist. Reine Rechnung; das Zeichnen liegt in layer.js.

/** Die drei Tiefen: Anteil, Länge des Strichs (px), Fallgeschwindigkeit (px/s), Breite, Deckkraft, Windanteil, Scrollanteil. */
export const RAIN_DEPTHS = {
  back: { share: 0.5, length: [7, 12], speed: [520, 680], width: 0.8, alpha: [0.08, 0.14], wind: 1.6, scroll: 0.55, splash: 0 },
  mid: { share: 0.32, length: [11, 18], speed: [720, 900], width: 1, alpha: [0.13, 0.2], wind: 2.4, scroll: 0.8, splash: 0.18 },
  front: { share: 0.18, length: [17, 27], speed: [950, 1250], width: 1.3, alpha: [0.2, 0.3], wind: 3.2, scroll: 1, splash: 0.35 },
};
export const RAIN_ORDER = ["back", "mid", "front"];
/** Nie deckender als das (#673: Alpha unter 0,35). */
export const MAX_ALPHA = 0.35;
/** Regen verträgt etwas mehr Teilchen als Schnee - ein Strich ist billig. */
export const RAIN_BUDGET = 1.2;
/** Wie weit seitlich über den Rand hinaus Tropfen entstehen, damit schräger Regen auch die Ränder trifft. */
export const SIDE_MARGIN = 160;
export const GRAVITY = 520;

/** Wie stark es regnet: 0 (gar nicht) bis 1,2 (Starkregen) aus `rain_mm`. */
export function rainFactor(weather) {
  const rain = Math.max(0, Number(weather && weather.rain_mm) || 0);
  if (rain <= 0) return 0;
  if (rain < 0.3) return 0.35;
  if (rain < 1.5) return 0.65;
  if (rain < 4) return 1;
  return 1.2;
}

/** Der Regen in einem Wort - für die Wetterkarte im Admin. */
export function rainLabel(weather) {
  const factor = rainFactor(weather);
  if (factor <= 0) return "kein Regen";
  if (factor <= 0.35) return "Nieselregen";
  if (factor <= 0.65) return "leichter Regen";
  if (factor <= 1) return "Regen";
  return "starker Regen";
}

/** Wie viele Tropfen je Tiefe: Budget (Gerät, Stärke) mal Seite mal Regenmenge; nachts etwas ruhiger. */
export function dropCounts(budget, { share = 1, factor = 0, night = false } = {}) {
  const total = Math.round(Math.max(0, budget) * RAIN_BUDGET * Math.max(0, Math.min(1, share)) * Math.max(0, factor) * (night ? 0.8 : 1));
  const back = Math.round(total * RAIN_DEPTHS.back.share);
  const mid = Math.round(total * RAIN_DEPTHS.mid.share);
  return { back, mid, front: Math.max(0, total - back - mid), total };
}

function between(rng, [min, max]) {
  return min + rng() * (max - min);
}

/** Ein neuer Tropfen oben (oder, beim Start, irgendwo im Bild) - auch seitlich über den Rand hinaus. */
export function createDrop(depthKey, size, rng, { anywhere = false } = {}) {
  const depth = RAIN_DEPTHS[depthKey] || RAIN_DEPTHS.mid;
  const length = between(rng, depth.length);
  return {
    depth: depthKey,
    x: -SIDE_MARGIN + rng() * (size.width + SIDE_MARGIN * 2),
    y: anywhere ? rng() * size.height : -length - rng() * 60,
    length,
    speed: between(rng, depth.speed),
    alpha: Math.min(MAX_ALPHA, between(rng, depth.alpha)),
    width: depth.width,
    splashes: rng() < depth.splash,
  };
}

/** Wie schnell der Tropfen seitlich treibt (px/s): der Wind mal der Anteil seiner Tiefe. */
export function driftOf(drop, wind) {
  const depth = RAIN_DEPTHS[drop.depth] || RAIN_DEPTHS.mid;
  return wind.x * depth.wind;
}

/**
 * Einen Schritt weiter. Liefert `previousY` (für das Auftreffen auf Kanten). Unten hinaus: oben wieder herein, an
 * neuer Stelle - außer `leaving` (der Regen lässt nach), dann ist der Tropfen `done`.
 */
export function advanceDrop(drop, dt, wind, size, rng = Math.random) {
  const previousY = drop.y;
  drop.x += driftOf(drop, wind) * dt;
  drop.y += drop.speed * dt;
  if (drop.y - drop.length > size.height) {
    if (drop.leaving) drop.done = true;
    else {
      drop.y = -drop.length - rng() * 40;
      drop.x = -SIDE_MARGIN + rng() * (size.width + SIDE_MARGIN * 2);
      drop.splashes = rng() < (RAIN_DEPTHS[drop.depth] || RAIN_DEPTHS.mid).splash;
    }
  }
  return previousY;
}

/** Scrollen: die Tropfen gehören zur Seite - vorne ganz, hinten weniger; hinausgeschoben kommen sie an neuer Stelle herein. */
export function scrollDrop(drop, deltaY, size, rng = Math.random) {
  if (!deltaY) return drop;
  const depth = RAIN_DEPTHS[drop.depth] || RAIN_DEPTHS.mid;
  const margin = drop.length + 20;
  const span = size.height + margin * 2;
  const moved = drop.y - deltaY * depth.scroll;
  const wrapped = ((((moved + margin) % span) + span) % span) - margin;
  if (Math.abs(wrapped - moved) > 0.5) drop.x = -SIDE_MARGIN + rng() * (size.width + SIDE_MARGIN * 2);
  drop.y = wrapped;
  return drop;
}

/** Die Kante, auf der der Tropfen in diesem Schritt landet (Fensterkoordinaten) - oder null. */
export function crossedEdge(drop, previousY, edges = []) {
  if (!drop.splashes) return null;
  return edges.find((edge) => drop.x >= edge.x1 && drop.x <= edge.x2 && previousY < edge.y && drop.y >= edge.y) || null;
}

/** Ein Spritzer: drei Tröpfchen, die kurz aufspringen und zurückfallen. */
export function createSplash(x, y, rng = Math.random) {
  return {
    x,
    y,
    age: 0,
    life: 0.26 + rng() * 0.14,
    parts: Array.from({ length: 3 }, () => ({ vx: (rng() - 0.5) * 90, vy: -(45 + rng() * 55), radius: 0.7 + rng() * 0.6 })),
  };
}

/** Wo die Tröpfchen eines Spritzers gerade sind und wie deckend - leer, wenn er vorbei ist. */
export function splashPoints(splash) {
  if (splash.age >= splash.life) return [];
  const fade = 1 - splash.age / splash.life;
  return splash.parts.map((part) => ({
    x: splash.x + part.vx * splash.age,
    y: splash.y + part.vy * splash.age + 0.5 * GRAVITY * splash.age * splash.age,
    radius: part.radius,
    alpha: Math.min(MAX_ALPHA, 0.3 * fade),
  }));
}
