// Gewitter (Wetter-Ebene, Wunsch des Betreibers vom 29.09.): meldet das Wetter am Vereinsort ein Gewitter, leuchtet
// es auf der Seite - selten, kurz, leise. Ein Wetterleuchten ist ein weicher Schein im oberen Teil des Fensters mit
// einem oder zwei Pulsen, manchmal mit einem feinen Blitz in der Ferne. Bewusst zahm: zwischen zwei Blitzen liegen
// mindestens acht Sekunden, ein Blitz hat höchstens zwei Pulse (weit unter drei Blitzen je Sekunde), der Schein
// bleibt unter 14 % Deckkraft und reicht nur bis zur Mitte des Fensters. Bei „Bewegung reduzieren“ gibt es die
// Ebene gar nicht. Reine Rechnung; gezeichnet wird in layer.js.

/** Pause zwischen zwei Blitzen (s), Länge eines Pulses (s), Abstand des zweiten Pulses (s). */
export const FLASH_GAP = [8, 25];
export const PULSE = { rise: 0.04, fall: 0.2, second: 0.15 };
export const FLASH_SECONDS = PULSE.second + PULSE.rise + PULSE.fall;
/** Höchste Deckkraft von Schein und Blitz. */
export const GLOW_ALPHA = 0.14;
export const BOLT_ALPHA = 0.42;
/** Wie weit der Schein nach unten reicht (Anteil der Fensterhöhe) und wie tief ein Blitz höchstens geht. */
export const GLOW_REACH = 0.5;
export const BOLT_REACH = [0.22, 0.42];

/** Meldet das Wetter ein Gewitter? Open-Meteo: 95 Gewitter, 96 und 99 mit Hagel. */
export function isThunderstorm(weather) {
  if (!weather || weather.stale) return false;
  const code = Number(weather.code);
  return Number.isFinite(code) && code >= 95 && code <= 99;
}

/** Wann der nächste Blitz kommt (Sekunden auf der Uhr der Ebene). */
export function nextFlashAt(rng, now = 0) {
  return now + FLASH_GAP[0] + rng() * (FLASH_GAP[1] - FLASH_GAP[0]);
}

/**
 * Der Weg eines Blitzes: vom oberen Rand des Himmels (`top` - unter der Kopfzeile) in Zacken nach unten, mit ein,
 * zwei kurzen Ästen. Fensterkoordinaten.
 */
export function boltPath(rng, size, top = 0) {
  const startX = size.width * (0.12 + rng() * 0.76);
  const depth = size.height * (BOLT_REACH[0] + rng() * (BOLT_REACH[1] - BOLT_REACH[0]));
  const steps = 6 + Math.floor(rng() * 5);
  const main = [{ x: startX, y: top }];
  for (let i = 1; i <= steps; i += 1) {
    const previous = main[i - 1];
    main.push({ x: previous.x + (rng() - 0.5) * 46, y: top + (depth * i) / steps });
  }
  const branches = [];
  const count = 1 + Math.floor(rng() * 2);
  for (let n = 0; n < count; n += 1) {
    const from = main[2 + Math.floor(rng() * Math.max(1, steps - 3))];
    const side = rng() < 0.5 ? -1 : 1;
    const branch = [from];
    for (let i = 1; i <= 3; i += 1) branch.push({ x: from.x + side * i * (10 + rng() * 14), y: from.y + i * (8 + rng() * 12) });
    branches.push(branch);
  }
  return { main, branches };
}

/** Ein Blitz: wo der Schein sitzt, wie hell er wird, ein oder zwei Pulse, mit oder ohne sichtbaren Blitz. */
export function createFlash(rng, size, startedAt = 0, top = 0) {
  const withBolt = rng() < 0.4;
  const bolt = withBolt ? boltPath(rng, size, top) : null;
  return {
    startedAt,
    top,
    x: bolt ? bolt.main[0].x : size.width * (0.1 + rng() * 0.8),
    strength: 0.6 + rng() * 0.4,
    pulses: rng() < 0.55 ? 2 : 1,
    bolt,
  };
}

function pulseAt(age) {
  if (age < 0) return 0;
  if (age < PULSE.rise) return age / PULSE.rise;
  if (age < PULSE.rise + PULSE.fall) return 1 - (age - PULSE.rise) / PULSE.fall;
  return 0;
}

/** Wie hell der Blitz gerade ist (0–1): erster Puls voll, der zweite schwächer. Danach 0 - der Blitz ist vorbei. */
export function flashLevel(flash, t) {
  const age = t - flash.startedAt;
  if (age < 0 || age > FLASH_SECONDS) return 0;
  const first = pulseAt(age);
  const second = flash.pulses > 1 ? pulseAt(age - PULSE.second) * 0.6 : 0;
  return Math.min(1, Math.max(first, second)) * flash.strength;
}

/** Ist der Blitz vorbei? */
export function flashDone(flash, t) {
  return t - flash.startedAt > FLASH_SECONDS;
}
