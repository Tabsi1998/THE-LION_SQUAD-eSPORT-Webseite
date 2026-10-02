// Konfetti mit eigener Physik (Fasching F1 #745): vier Formen - Quadrat, Streifen, Punkt, Papierfetzen -, jede mit
// eigener Masse (Fallgeschwindigkeit), eigenem Luftwiderstand, eigener Drehung und eigenem Flattern (das Stück kippt
// beim Fallen um seine Achse, man sieht abwechselnd Vorder- und Rückseite). Wind kommt aus dem Wetter. Geschlossene
// Bahnen wie beim Feuerwerk: der Ort zu jeder Zeit ohne Schritt für Schritt zu rechnen. Reine Rechnung - die App
// rechnet dasselbe (mobile/src/seasons/carnival/confetti.ts, Paritätstest).

export const GRAVITY = 520;

/** Die Formen: Größe (Breite, Höhe), Luftwiderstand (je größer, desto langsamer), Flattern, Drehung (rad/s). */
export const SHAPES = {
  square: { w: [6, 9], h: [6, 9], drag: 2.6, flutter: 1.0, spin: [2, 5] },
  strip: { w: [3, 4], h: [10, 16], drag: 2.0, flutter: 0.7, spin: [4, 9] },
  dot: { w: [5, 7], h: [5, 7], drag: 3.0, flutter: 0.9, spin: [1, 3] },
  scrap: { w: [5, 10], h: [3, 7], drag: 2.3, flutter: 1.2, spin: [3, 7] },
};
export const SHAPE_NAMES = Object.keys(SHAPES);
export const SHAPE_WEIGHTS = { square: 4, strip: 3, dot: 2, scrap: 2 };

/** Vereinsfarben zuerst (Cyan, Gold), dann bunt - je Farbe Vorder- und etwas dunklere Rückseite. */
export const COLORS = [
  ["#29B6E8", "#1c86ab"], ["#FFD700", "#c9a800"], ["#ff4fa3", "#c23a7c"], ["#3ddc84", "#2aa863"],
  ["#ff8a3d", "#c9682b"], ["#a66bff", "#7f4fd1"], ["#ff4d4d", "#c43a3a"], ["#f5f5f5", "#bdbdbd"],
];
/** Nur Vereinsfarben (Vereinsgeburtstag #751): Blau, Gold, Weiß. */
export const CLUB_PALETTE = [0, 1, 7];

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const between = (rng, [low, high]) => low + rng() * (high - low);

function pickShape(rng) {
  const total = SHAPE_NAMES.reduce((sum, name) => sum + SHAPE_WEIGHTS[name], 0);
  let roll = rng() * total;
  for (const name of SHAPE_NAMES) {
    roll -= SHAPE_WEIGHTS[name];
    if (roll <= 0) return name;
  }
  return SHAPE_NAMES[0];
}

function makePiece(rng, { x, y, vx, vy, at }, palette = null) {
  const shape = pickShape(rng);
  const spec = SHAPES[shape];
  // Masse: jedes Stück ein wenig anders schwer - so fällt nichts im Gleichschritt.
  const drag = round(spec.drag * (0.82 + rng() * 0.4), 3);
  // Ohne Auswahl fast die Hälfte in Vereinsfarben, sonst bunt; mit Auswahl (Vereinsgeburtstag) nur diese Farben.
  const color = palette && palette.length ? palette[Math.floor(rng() * palette.length)] : Math.floor(rng() * (rng() < 0.45 ? 2 : COLORS.length));
  return {
    shape,
    x: round(x), y: round(y), vx: round(vx), vy: round(vy), at: Math.round(at),
    w: round(between(rng, spec.w)), h: round(between(rng, spec.h)),
    drag,
    sway: round((6 + rng() * 12) * spec.flutter),
    swayRate: round(2 + rng() * 2.2, 3),
    swayPhase: round(rng() * Math.PI * 2, 3),
    spin: round(between(rng, spec.spin) * (rng() < 0.5 ? -1 : 1), 3),
    angle: round(rng() * Math.PI * 2, 3),
    flipRate: round(3 + rng() * 6, 3),
    flipPhase: round(rng() * Math.PI * 2, 3),
    color,
    corners: shape === "scrap" ? Array.from({ length: 5 }, () => round(0.65 + rng() * 0.35, 2)) : null,
  };
}

/**
 * Der Regen beim ersten Aufruf des Tages: `count` Stücke über die Breite verteilt, oberhalb des Fensters, gestaffelt
 * über `spreadMs` - danach fällt nichts mehr nach (kein Dauerregen).
 */
export function rainPieces(rng, { width, height }, count, spreadMs = 2500, palette = null) {
  return Array.from({ length: count }, () => makePiece(rng, {
    x: -0.05 * width + rng() * width * 1.1,
    y: -20 - rng() * height * 0.25,
    vx: (rng() - 0.5) * 60,
    vy: 20 + rng() * 60,
    at: rng() * spreadMs,
  }, palette));
}

/** Eine kleine Explosion an einer Stelle (Partyhut angetippt): nach oben und zur Seite, dann rieselt es herab. */
export function burstPieces(rng, { x, y }, count, palette = null) {
  return Array.from({ length: count }, () => {
    const angle = (-160 + rng() * 140) * (Math.PI / 180);
    const speed = 250 + rng() * 270;
    return makePiece(rng, { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, at: rng() * 60 }, palette);
  });
}

/** Der Wind als Seitwärts-Geschwindigkeit (px/s) aus dem Wetter: Stärke 0…1, Richtung in Grad. */
export function confettiWind(weather) {
  const factor = Number(weather?.wind_factor);
  if (!Number.isFinite(factor) || factor <= 0) return 0;
  const dir = Number(weather?.wind_dir);
  const side = Number.isFinite(dir) ? Math.sin(((dir + 180) * Math.PI) / 180) : 1;
  return round(side * factor * 70);
}

/**
 * Wo ein Stück `t` Sekunden nach seinem Start ist: Luftwiderstand zieht die Geschwindigkeit zur Endgeschwindigkeit
 * (seitlich der Wind, nach unten Schwerkraft/Widerstand), dazu das Flattern, die Drehung und das Kippen (`flip`
 * zwischen -1 und 1 - nahe 0 sieht man das Stück von der Kante).
 */
export function pieceAt(piece, t, wind = 0) {
  if (t < 0) return null;
  const k = piece.drag;
  const decay = Math.exp(-k * t);
  const fall = GRAVITY / k;
  const x = piece.x + wind * t + ((piece.vx - wind) * (1 - decay)) / k + piece.sway * Math.sin(piece.swayRate * t + piece.swayPhase) * (1 - Math.exp(-2 * t));
  const y = piece.y + fall * t + ((piece.vy - fall) * (1 - decay)) / k;
  return {
    x: round(x),
    y: round(y),
    angle: round(piece.angle + piece.spin * t, 3),
    flip: round(Math.cos(piece.flipRate * t + piece.flipPhase), 3),
  };
}
