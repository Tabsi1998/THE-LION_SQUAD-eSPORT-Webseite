// Konfetti mit eigener Physik (Fasching F1 #745), dieselbe Rechnung wie im Web (frontend/src/seasons/carnival/
// confetti.js; Abgleich im Test): vier Formen mit eigener Masse, eigenem Luftwiderstand und Flattern, jede mit eigener
// Drehung und eigenem Kippen. Wo ein Stück zur Zeit t ist, steht in geschlossener Form da (kein Aufsummieren je Bild):
// Fall mit Luftwiderstand auf die Endgeschwindigkeit, der Wind schiebt seitlich, das Flattern kommt mit der Zeit.
// `pieceAt` läuft als Worklet auf dem UI-Thread; das Erzeugen geschieht auf dem JS-Thread.

export const GRAVITY = 520;

type Spec = { w: [number, number]; h: [number, number]; drag: number; flutter: number; spin: [number, number] };
export const SHAPES: Record<"square" | "strip" | "dot" | "scrap", Spec> = {
  square: { w: [6, 9], h: [6, 9], drag: 2.6, flutter: 1.0, spin: [2, 5] },
  strip: { w: [3, 4], h: [10, 16], drag: 2.0, flutter: 0.7, spin: [4, 9] },
  dot: { w: [5, 7], h: [5, 7], drag: 3.0, flutter: 0.9, spin: [1, 3] },
  scrap: { w: [5, 10], h: [3, 7], drag: 2.3, flutter: 1.2, spin: [3, 7] },
};
export type Shape = keyof typeof SHAPES;
export const SHAPE_NAMES = Object.keys(SHAPES) as Shape[];
export const SHAPE_WEIGHTS: Record<Shape, number> = { square: 4, strip: 3, dot: 2, scrap: 2 };
/** Vorder- und Rückseite: Vereinsfarben zuerst, dann bunt. */
export const COLORS: Array<[string, string]> = [["#29B6E8", "#1c86ab"], ["#FFD700", "#c9a800"], ["#ff4fa3", "#c23a7c"], ["#3ddc84", "#2aa863"], ["#ff8a3d", "#c9682b"], ["#a66bff", "#7f4fd1"], ["#ff4d4d", "#c43a3a"], ["#f5f5f5", "#bdbdbd"]];

export type Piece = {
  shape: Shape;
  x: number;
  y: number;
  vx: number;
  vy: number;
  at: number;
  w: number;
  h: number;
  drag: number;
  sway: number;
  swayRate: number;
  swayPhase: number;
  spin: number;
  angle: number;
  flipRate: number;
  flipPhase: number;
  color: number;
  corners: number[] | null;
};
export type PieceAt = { x: number; y: number; angle: number; flip: number };
type Rng = () => number;

function round(value: number, digits = 2): number {
  "worklet";
  return Math.round(value * 10 ** digits) / 10 ** digits;
}

const between = (rng: Rng, [low, high]: [number, number]) => low + rng() * (high - low);

function pickShape(rng: Rng): Shape {
  const total = SHAPE_NAMES.reduce((sum, name) => sum + SHAPE_WEIGHTS[name], 0);
  let roll = rng() * total;
  for (const name of SHAPE_NAMES) {
    roll -= SHAPE_WEIGHTS[name];
    if (roll <= 0) return name;
  }
  return SHAPE_NAMES[0];
}

function makePiece(rng: Rng, { x, y, vx, vy, at }: { x: number; y: number; vx: number; vy: number; at: number }): Piece {
  const shape = pickShape(rng);
  const spec = SHAPES[shape];
  const drag = round(spec.drag * (0.82 + rng() * 0.4), 3);
  const color = Math.floor(rng() * (rng() < 0.45 ? 2 : COLORS.length));
  return {
    shape,
    x: round(x),
    y: round(y),
    vx: round(vx),
    vy: round(vy),
    at: Math.round(at),
    w: round(between(rng, spec.w)),
    h: round(between(rng, spec.h)),
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

/** Der Regen: über die ganze Breite (etwas darüber hinaus), oberhalb des Fensters, über `spreadMs` verteilt. */
export function rainPieces(rng: Rng, { width, height }: { width: number; height: number }, count: number, spreadMs = 2500): Piece[] {
  return Array.from({ length: count }, () => makePiece(rng, { x: -0.05 * width + rng() * width * 1.1, y: -20 - rng() * height * 0.25, vx: (rng() - 0.5) * 60, vy: 20 + rng() * 60, at: rng() * spreadMs }));
}

/** Eine Explosion: aus einem Punkt nach oben und zur Seite, schnell, dann bremst die Luft und es fällt. */
export function burstPieces(rng: Rng, { x, y }: { x: number; y: number }, count: number): Piece[] {
  return Array.from({ length: count }, () => {
    const angle = (-160 + rng() * 140) * (Math.PI / 180);
    const speed = 250 + rng() * 270;
    return makePiece(rng, { x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, at: rng() * 60 });
  });
}

/** Wind aus dem Wetter (Punkte je Sekunde, seitlich): woher er weht, gibt die Richtung. */
export function confettiWind(weather: { wind_factor?: unknown; wind_dir?: unknown } | null | undefined): number {
  "worklet";
  const factor = Number(weather?.wind_factor);
  if (!Number.isFinite(factor) || factor <= 0) return 0;
  const dir = Number(weather?.wind_dir);
  const side = Number.isFinite(dir) ? Math.sin(((dir + 180) * Math.PI) / 180) : 1;
  return round(side * factor * 70);
}

/** Wo ein Stück `t` Sekunden nach seinem Start ist - null vor dem Start. `flip` ist das Kippen (−1…1). */
export function pieceAt(piece: Piece, t: number, wind = 0): PieceAt | null {
  "worklet";
  if (t < 0) return null;
  const k = piece.drag;
  const decay = Math.exp(-k * t);
  const fall = GRAVITY / k;
  const x = piece.x + wind * t + ((piece.vx - wind) * (1 - decay)) / k + piece.sway * Math.sin(piece.swayRate * t + piece.swayPhase) * (1 - Math.exp(-2 * t));
  const y = piece.y + fall * t + ((piece.vy - fall) * (1 - decay)) / k;
  return { x: round(x), y: round(y), angle: round(piece.angle + piece.spin * t, 3), flip: round(Math.cos(piece.flipRate * t + piece.flipPhase), 3) };
}
