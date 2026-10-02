// Silvester (Jahreszeiten II S9, #640; N1 #739): die Rechnung eines Feuerwerks - Aufstieg mit Funkenspur, Explosion
// je Art, Nachglühen, absinkende Funken, Rauch und Wind, Entfernung. Reine Funktionen ohne Browser: Bahnen sind
// geschlossene Formeln (Luftwiderstand und Schwerkraft), damit das Bild nicht von der Bildrate abhängt und die App
// dieselbe Rechnung übernehmen kann (mobile/src/seasons/newYear/fireworks.ts, Paritätstest auf beiden Seiten).

import { between } from "../rng";

/** Schwerkraft in px/s² für eine nahe Rakete; ferne fallen im Bild langsamer (kleiner). */
export const GRAVITY = 46;

/**
 * Die Arten (N1): jede mit eigener Sternzahl, Geschwindigkeit, Luftwiderstand, Schwere, Lebensdauer, Spur und
 * Aufstieg - Pfingstrose (Kugel), Chrysantheme (Kugel mit Spuren und Glitzern), Weide (lange, fallende Goldspuren),
 * Knister (zerplatzt am Ende in kleine Blitze), Ring (geneigter Kreis), Herz (selten).
 */
export const SHELLS = {
  peony: { stars: [56, 80], speed: [190, 260], drag: 1.55, gravity: 1, life: [1.3, 1.8], trail: 0, glitter: 0, rise: [1.2, 1.5], size: 2.2 },
  chrysanthemum: { stars: [48, 68], speed: [195, 265], drag: 1.4, gravity: 1, life: [1.7, 2.3], trail: 0.2, glitter: 0.4, rise: [1.3, 1.6], size: 1.9 },
  willow: { stars: [40, 58], speed: [130, 175], drag: 1.45, gravity: 0.55, life: [3.2, 4.2], trail: 0.6, glitter: 0.2, rise: [1.55, 1.9], size: 1.7 },
  crackle: { stars: [36, 50], speed: [165, 225], drag: 1.6, gravity: 0.9, life: [1.0, 1.35], trail: 0.08, glitter: 0, rise: [1.05, 1.3], size: 1.7 },
  ring: { stars: [36, 48], speed: [200, 230], drag: 1.5, gravity: 0.8, life: [1.4, 1.8], trail: 0.1, glitter: 0, rise: [1.3, 1.6], size: 2.0 },
  heart: { stars: [42, 54], speed: [160, 185], drag: 1.35, gravity: 0.65, life: [1.6, 2.0], trail: 0.1, glitter: 0, rise: [1.4, 1.7], size: 2.1 },
};

/** Wie groß ein Feuerwerk im Fenster wirkt: nach der Höhe (900 px = 1), auf dem Handy kleiner, auf großen Schirmen etwas größer. */
export function spreadFor(size) {
  return Math.round(Math.max(0.5, Math.min(1.3, (Number(size?.height) || 900) / 900)) * 100) / 100;
}
export const SHELL_TYPES = Object.keys(SHELLS);

/** Farben: Vereinsblau, Gold, Silber, Weiß - dazu Rot, Grün und Violett für Akzente; die Glut am Ende ist orange. */
export const COLORS = { blue: "#29B6E8", gold: "#ffc857", silver: "#dfe7ee", white: "#ffffff", red: "#e8453c", green: "#4fd18b", violet: "#a678f0" };
export const EMBER = "#ff8a3c";

/** Entfernung 0 (nah) bis 1 (fern): Größe, Helligkeit und - für den Klang - die Verzögerung des Knalls. */
export function distanceScale(distance) {
  return 1 - 0.45 * clamp01(distance);
}

export function distanceLight(distance) {
  return 1 - 0.4 * clamp01(distance);
}

/** Schall braucht vom fernen Feuerwerk länger: bis knapp eine Sekunde (für das Ohr glaubwürdig, nicht maßstabsgetreu). */
export function soundDelay(distance) {
  return Math.round((0.05 + 0.85 * clamp01(distance)) * 100) / 100;
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

/** Der Wind des Wetters als seitliche Drift in px/s (Faktor wie im Web-Wetter, Richtung: Westwind treibt nach rechts). */
export function windDrift(weather) {
  const factor = Math.max(0, Math.min(2, Number(weather?.wind_factor ?? 0.6)));
  const dir = Number(weather?.wind_dir);
  const sign = Number.isFinite(dir) ? (Math.sin(((dir + 180) * Math.PI) / 180) >= 0 ? 1 : -1) : 1;
  return Math.round(sign * factor * 14 * 100) / 100;
}

function easeOutQuad(t) {
  return 1 - (1 - t) * (1 - t);
}

/**
 * Die Rakete im Aufstieg: von unten (knapp unter dem Rand) bis zum Zerplatzpunkt, gebremst (easeOut), mit einer
 * kleinen eigenen Abweichung (`drift`) und dem Wind. `t` in Sekunden seit dem Start; null, wenn sie schon zerplatzt ist.
 */
export function rocketAt(launch, t, size, wind = 0) {
  if (t < 0 || t > launch.rise) return null;
  const p = easeOutQuad(t / launch.rise);
  const startY = size.height + 12;
  const burst = burstPoint(launch, size, wind);
  const x0 = launch.x * size.width;
  return {
    x: Math.round((x0 + (burst.x - x0) * p) * 10) / 10,
    y: Math.round((startY + (burst.y - startY) * p) * 10) / 10,
    // Die Spur ist am Anfang lang und wird zum Gipfel hin kurz - die Rakete bremst.
    speed: Math.round((1 - t / launch.rise) * 100) / 100,
  };
}

/** Wo die Rakete zerplatzt: über ihrem Startpunkt, verschoben um die eigene Abweichung und den Wind im Aufstieg. */
export function burstPoint(launch, size, wind = 0) {
  return {
    x: Math.round((launch.x * size.width + launch.drift * distanceScale(launch.distance) + wind * launch.rise * 0.5) * 10) / 10,
    y: Math.round(launch.burstY * size.height * 10) / 10,
  };
}

/** Ein Punkt auf dem Herz (t 0..2π), auf Radius 1 gebracht. */
function heartPoint(t) {
  const x = 16 * Math.sin(t) ** 3;
  const y = -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t));
  return { x: x / 17, y: y / 17 };
}

/**
 * Die Sterne einer Explosion: Richtung und Tempo je Art (Kugel, geneigter Ring, Herz), Lebensdauer, Größe, Farbe
 * (Hauptfarbe, ein Teil in der Zweitfarbe), Glitzern und - beim Knister - der Moment des Zerplatzens. `scale` ist der
 * Anteil am Teilchenbudget (0–1): bei knappem Budget weniger Sterne, nie weniger als zwölf. `spread` ist die Größe
 * im Fenster (`spreadFor`).
 */
export function burstStars(launch, rng, scale = 1, spread = 1) {
  const shell = SHELLS[launch.type] || SHELLS.peony;
  const near = distanceScale(launch.distance);
  const wanted = Math.round(between(rng, shell.stars[0], shell.stars[1]));
  const count = Math.max(12, Math.round(wanted * Math.max(0, Math.min(1, scale))));
  const speed = between(rng, shell.speed[0], shell.speed[1]) * near * spread;
  const tilt = launch.type === "ring" ? between(rng, 0.3, 0.75) : 1;
  const spin = between(rng, 0, Math.PI * 2);
  const stars = [];
  for (let i = 0; i < count; i += 1) {
    let dx;
    let dy;
    let v = speed;
    if (launch.type === "ring") {
      const a = spin + (i / count) * Math.PI * 2;
      dx = Math.cos(a);
      dy = Math.sin(a) * tilt;
    } else if (launch.type === "heart") {
      const point = heartPoint((i / count) * Math.PI * 2);
      dx = point.x;
      dy = point.y;
    } else {
      // Kugel, auf die Bildebene projiziert: Sterne vorn und hinten wirken langsamer - das macht die Kugel rund.
      const a = between(rng, 0, Math.PI * 2);
      const z = between(rng, -1, 1);
      const r = Math.sqrt(1 - z * z);
      dx = Math.cos(a) * r;
      dy = Math.sin(a) * r;
      v = speed * between(rng, 0.92, 1.04);
    }
    const second = rng() < 0.28;
    stars.push({
      vx: Math.round(dx * v * 100) / 100,
      vy: Math.round(dy * v * 100) / 100,
      life: Math.round(between(rng, shell.life[0], shell.life[1]) * 100) / 100,
      size: Math.round(shell.size * near * between(rng, 0.8, 1.2) * 100) / 100,
      color: second ? launch.colors[1] : launch.colors[0],
      glitter: rng() < shell.glitter ? Math.round(between(rng, 0, Math.PI * 2) * 100) / 100 : null,
      crackleAt: launch.type === "crackle" ? Math.round(between(rng, 0.55, 0.78) * 100) / 100 : null,
    });
  }
  return stars;
}

/**
 * Wo ein Stern nach `age` Sekunden steht - geschlossen gerechnet: Luftwiderstand `drag` bremst exponentiell, die
 * Schwerkraft zieht ihn gegen eine Endgeschwindigkeit nach unten, der Wind treibt ihn seitlich.
 */
export function starAt(star, age, shell, origin, wind = 0, distance = 0) {
  const k = shell.drag;
  const g = GRAVITY * shell.gravity * distanceScale(distance);
  const decay = (1 - Math.exp(-k * age)) / k;
  const terminal = g / k;
  return {
    x: Math.round((origin.x + star.vx * decay + wind * age * 0.6) * 10) / 10,
    y: Math.round((origin.y + terminal * age + (star.vy - terminal) * decay) * 10) / 10,
  };
}

/**
 * Wie hell ein Stern ist (0–1) und welche Farbe er hat: ein kurzer Blitz beim Zerplatzen, dann voll, im letzten
 * Drittel Nachglühen zur Glut hin und aus. Glitzernde Sterne flackern; der Knister erlischt beim Zerplatzen.
 */
export function starLight(star, age) {
  const p = age / star.life;
  if (p >= 1 || p < 0) return { alpha: 0, ember: 0 };
  if (star.crackleAt !== null && star.crackleAt !== undefined && p >= star.crackleAt) return { alpha: 0, ember: 0 };
  let alpha = p < 0.06 ? 1 : p < 0.6 ? 0.95 : 0.95 * (1 - (p - 0.6) / 0.4) ** 1.4;
  if (star.glitter !== null && star.glitter !== undefined && p > 0.25) alpha *= 0.55 + 0.45 * Math.abs(Math.sin(age * 38 + star.glitter));
  const ember = p < 0.6 ? 0 : Math.min(1, (p - 0.6) / 0.35);
  return { alpha: Math.round(alpha * 1000) / 1000, ember: Math.round(ember * 1000) / 1000 };
}

/** Das Knistern: kurze Blitze um die Stelle, an der ein Knister-Stern zerplatzt (für 0,14 s). */
export const CRACKLE_SECONDS = 0.14;

export function crackleFlashes(star, rng) {
  const n = 3 + Math.floor(rng() * 3);
  return Array.from({ length: n }, () => ({ dx: Math.round(between(rng, -5, 5) * 10) / 10, dy: Math.round(between(rng, -5, 5) * 10) / 10, size: Math.round(between(rng, 0.6, 1.3) * 100) / 100 }));
}

/** Rauch nach der Explosion: eine Wolke wächst, steigt kaum, treibt mit dem Wind und vergeht in einigen Sekunden. */
export const SMOKE_SECONDS = 9;

export function smokeAt(origin, age, wind = 0, distance = 0) {
  if (age < 0 || age > SMOKE_SECONDS) return null;
  const scale = distanceScale(distance);
  const p = age / SMOKE_SECONDS;
  return {
    x: Math.round((origin.x + wind * age * 0.9) * 10) / 10,
    y: Math.round((origin.y - 5 * age) * 10) / 10,
    r: Math.round((24 + 70 * Math.sqrt(p)) * scale * 10) / 10,
    alpha: Math.round(0.11 * (1 - p) ** 1.3 * distanceLight(distance) * 1000) / 1000,
  };
}

/** Die Funkenspur im Aufstieg: wie viele Funken je Sekunde (nah mehr) und wie lange einer glimmt. */
export function trailRate(launch) {
  return Math.round(60 * distanceScale(launch.distance));
}

export const SPARK_SECONDS = 0.45;

/** Wie lange eine Rakete insgesamt sichtbar ist: Aufstieg plus die längste Lebensdauer ihrer Art. */
export function launchDuration(launch) {
  const shell = SHELLS[launch.type] || SHELLS.peony;
  return Math.round((launch.rise + shell.life[1] + 0.2) * 100) / 100;
}
