// Schneefall (Jahreszeiten II S7, #638; Advent & Winter W2, #728): Flocken in drei Tiefen - hinten klein, weich
// und schnell, in der Mitte mittel, vorne groß, langsam und als Kristall. Keine zwei Flocken gleich: eigene Form,
// Größe, Fallgeschwindigkeit, Taumeln (Drehung), Schwingen oder Spiralen mit eigener Phase, ein paar schnelle
// Ausreißer. Der Wind kommt aus dem Wetter (Stärke und Richtung), dazu Böen alle 20–40 s, die alle Ebenen
// gemeinsam schieben - vorne mehr als hinten. Reine Rechnung für den gemeinsamen Canvas-Loop (sky.js); das
// Zeichnen liegt in layer.js.

/** Die drei Tiefen: Anteil am Budget, Größe, Fallgeschwindigkeit (px/s), Anteil des Winds, Schwingweite. */
export const DEPTHS = {
  back: { share: 0.5, size: [1.2, 2.2], fall: [42, 70], wind: 0.45, sway: [4, 10], spin: 0, soft: true },
  mid: { share: 0.32, size: [2.2, 3.6], fall: [30, 52], wind: 0.75, sway: [8, 18], spin: 0.6, soft: false },
  front: { share: 0.18, size: [3.8, 6.5], fall: [18, 36], fall2: 26, wind: 1.1, sway: [12, 26], spin: 1.2, soft: false },
};
export const DEPTH_ORDER = ["back", "mid", "front"];
/** Sechs Formen: weicher Punkt, Sternkristall, Plättchen, Nadelpaar, Klümpchen, Dendrit. */
export const SHAPES = ["dot", "star", "plate", "needle", "clump", "dendrite"];
/** Böen: alle 20–40 s, 3–6 s lang, 1,6- bis 2,8-fach, mit weichem Anstieg und Abklingen. */
export const GUST = { every: [20, 40], length: [3, 6], strength: [1.6, 2.8], attack: 1, release: 2 };
/** Jede zwölfte Flocke ist ein schneller Ausreißer (W2: „einzelne schnelle Flocken“). */
export const FAST_EVERY = 12;

/** Der Wind aus dem Wetter: Stärke 0,3–1,6 (`wind_factor`), Richtung in Grad, aus der er kommt (270 = West → nach rechts). */
export function windFrom(weather) {
  const factor = Math.max(0.3, Math.min(1.6, Number(weather && weather.wind_factor) || 0.6));
  const direction = Number(weather && weather.wind_dir);
  const sign = Number.isFinite(direction) ? (Math.sin((direction * Math.PI) / 180) <= 1e-9 ? 1 : -1) : 1;
  return { factor, sign };
}

/** Der Böenplan aus dem Zufallsstrom: wann die nächste kommt, wie lang, wie stark. */
export function nextGust(rng, now = 0) {
  const at = now + GUST.every[0] + rng() * (GUST.every[1] - GUST.every[0]);
  return { at, length: GUST.length[0] + rng() * (GUST.length[1] - GUST.length[0]), strength: GUST.strength[0] + rng() * (GUST.strength[1] - GUST.strength[0]) };
}

/** Wie stark die Böe gerade weht (1 = kein Zuschlag): weicher Anstieg, Plateau, Abklingen. */
export function gustAt(gust, t) {
  if (!gust || t < gust.at) return 1;
  const into = t - gust.at;
  if (into < GUST.attack) return 1 + (gust.strength - 1) * (into / GUST.attack);
  if (into < GUST.attack + gust.length) return gust.strength;
  const out = into - GUST.attack - gust.length;
  if (out < GUST.release) return 1 + (gust.strength - 1) * (1 - out / GUST.release);
  return 1;
}

/** Der Wind zum Zeitpunkt t (Sekunden): Grundwind mit langsamem Auf und Ab mal Böe; x in px/s (Vorzeichen = Richtung), y drückt etwas nach unten. */
export function windAt(t, { factor = 0.6, sign = 1 } = {}, gust = null) {
  const breath = 1 + 0.25 * Math.sin(t / 5.3) + 0.12 * Math.sin(t / 1.9 + 1);
  const strength = factor * breath * gustAt(gust, t);
  return { x: sign * (8 + 38 * strength), y: 6 * strength, strength };
}

function between(rng, [min, max]) {
  return min + rng() * (max - min);
}

/** Eine neue Flocke oben (oder, beim Start, irgendwo im Bild). */
export function createFlake(depthKey, size, rng, { index = 0, anywhere = false } = {}) {
  const depth = DEPTHS[depthKey] || DEPTHS.mid;
  const fast = !depth.soft && index % FAST_EVERY === FAST_EVERY - 1;
  const radius = between(rng, depth.size);
  const fall = between(rng, depth.fall) * (fast ? 2.2 : 1);
  const spiral = !depth.soft && rng() < 0.3;
  return {
    depth: depthKey,
    shape: depth.soft ? "dot" : SHAPES[Math.floor(rng() * SHAPES.length)],
    x: rng() * size.width,
    y: anywhere ? rng() * size.height : -radius * 2 - rng() * 40,
    radius,
    fall,
    fast,
    swayAmp: between(rng, depth.sway) * (spiral ? 0.6 : 1),
    swayFreq: 0.4 + rng() * 0.9,
    phase: rng() * Math.PI * 2,
    spiral,
    rotation: rng() * Math.PI * 2,
    spin: (rng() - 0.5) * 2 * depth.spin,
    opacity: depth.soft ? 0.35 + rng() * 0.3 : 0.6 + rng() * 0.35,
    age: rng() * 10,
  };
}

/** Einen Schritt weiter: fallen, schwingen oder spiralen, driften mit dem Wind, taumeln; unten und seitlich wieder hinein. */
export function advanceFlake(flake, dt, wind, size) {
  const depth = DEPTHS[flake.depth] || DEPTHS.mid;
  flake.age += dt;
  const swing = Math.sin(flake.age * flake.swayFreq * Math.PI * 2 + flake.phase);
  const sway = flake.spiral ? Math.cos(flake.age * flake.swayFreq * Math.PI * 2 + flake.phase) * flake.swayAmp * 1.4 : swing * flake.swayAmp;
  flake.x += (sway + wind.x * depth.wind) * dt;
  flake.y += (flake.fall + wind.y * depth.wind + (flake.spiral ? Math.abs(swing) * 4 : 0)) * dt;
  flake.rotation += flake.spin * dt * (1 + wind.strength * 0.3);
  const margin = flake.radius * 3 + 10;
  if (flake.x < -margin) flake.x = size.width + margin;
  else if (flake.x > size.width + margin) flake.x = -margin;
  if (flake.y > size.height + margin) {
    flake.y = -margin;
    flake.x = Math.random() * size.width;
  }
  return flake;
}

/**
 * Wie viele Flocken je Tiefe: `budget` vom Gerät und der Stärke (sky.js), `share` der Seite (Klasse), `weather`
 * (echter Schneefall → volle Zahl, sonst 55 %), `fade` 0–1 gegen Ende der Saison.
 */
export function flakeCounts(budget, { share = 1, snowing = false, fade = 1 } = {}) {
  const total = Math.round(Math.max(0, budget) * Math.max(0, Math.min(1, share)) * (snowing ? 1 : 0.55) * Math.max(0, Math.min(1, fade)));
  const back = Math.round(total * DEPTHS.back.share);
  const mid = Math.round(total * DEPTHS.mid.share);
  return { back, mid, front: Math.max(0, total - back - mid), total };
}

/** Der Ausklang (S7): in den letzten zehn Minuten der Saison werden es weniger, kein hartes Abschalten. */
export function fadeAt(endsAt, now = Date.now()) {
  const end = Date.parse(endsAt || "");
  if (!Number.isFinite(end)) return 1;
  const left = end - now;
  if (left <= 0) return 0;
  return Math.min(1, left / (10 * 60 * 1000));
}
