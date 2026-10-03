import { hashString, mulberry32 } from "../rng";
import { GRAVITY, SHAPES, burstPieces, confettiWind, pieceAt, rainPieces } from "./confetti";

// Konfetti mit eigener Physik (F1 #745): Formen verhalten sich verschieden, nichts fällt im Gleichschritt, der Wind
// trägt zur Seite, der Regen hat einen klaren Anfang und ein Ende. Die App rechnet dasselbe (gleicher Fingerabdruck
// in mobile/src/seasons/carnival/confetti.test.ts).

const CONFETTI_PARITY = 1776546414;
const SIZE = { width: 1280, height: 800 };

test("Endgeschwindigkeit je Form: Streifen fallen schneller als Punkte; Quadrate flattern", () => {
  const fall = (shape) => GRAVITY / SHAPES[shape].drag;
  expect(fall("strip")).toBeGreaterThan(fall("square"));
  expect(fall("square")).toBeGreaterThan(fall("dot"));
  expect(SHAPES.scrap.flutter).toBeGreaterThan(SHAPES.strip.flutter);
});

test("nichts im Gleichschritt: nach drei Sekunden liegen die Stücke weit auseinander, alle Formen kommen vor", () => {
  const pieces = rainPieces(mulberry32(7), SIZE, 120);
  const ys = pieces.map((piece) => pieceAt(piece, 3).y);
  const spread = Math.max(...ys) - Math.min(...ys);
  expect(spread).toBeGreaterThan(200);
  expect(new Set(pieces.map((piece) => piece.shape))).toEqual(new Set(["square", "strip", "dot", "scrap"]));
  expect(new Set(pieces.map((piece) => piece.drag)).size).toBeGreaterThan(100);
  // Regen: alle starten oberhalb des Fensters und innerhalb von 2,5 Sekunden - danach fällt nichts mehr nach.
  pieces.forEach((piece) => {
    expect(piece.y).toBeLessThan(0);
    expect(piece.at).toBeLessThanOrEqual(2500);
  });
});

test("flattert und kippt: die Seite wechselt, die Drehung läuft weiter", () => {
  const [piece] = rainPieces(mulberry32(3), SIZE, 1);
  const flips = Array.from({ length: 20 }, (_, i) => pieceAt(piece, i * 0.1).flip);
  expect(flips.some((flip) => flip > 0.5)).toBe(true);
  expect(flips.some((flip) => flip < -0.5)).toBe(true);
  expect(pieceAt(piece, 1).angle).not.toBe(pieceAt(piece, 0).angle);
  expect(pieceAt(piece, -0.1)).toBeNull();
});

test("Explosion: erst nach oben, dann rieselt es herab; der Wind trägt zur Seite", () => {
  const pieces = burstPieces(mulberry32(11), { x: 400, y: 300 }, 40);
  const early = pieces.map((piece) => pieceAt(piece, 0.15).y);
  expect(early.filter((y) => y < 300).length).toBeGreaterThan(30);
  const late = pieces.map((piece) => pieceAt(piece, 4).y);
  expect(late.every((y) => y > 300)).toBe(true);
  const [one] = pieces;
  expect(pieceAt(one, 4, 60).x).toBeGreaterThan(pieceAt(one, 4, 0).x + 100);
  expect(confettiWind(null)).toBe(0);
  expect(confettiWind({ wind_factor: 0.5, wind_dir: 270 })).toBeCloseTo(35, 0);
});

test("Parität mit der App: derselbe Fingerabdruck für Regen, Explosion und Bahnen", () => {
  const rain = rainPieces(mulberry32(2027), SIZE, 24);
  const burst = burstPieces(mulberry32(42), { x: 300, y: 200 }, 12);
  const paths = [...rain, ...burst].map((piece) => [0, 0.4, 1.3, 2.7].map((t) => pieceAt(piece, t, 25)));
  expect(hashString(JSON.stringify({ rain, burst, paths }))).toBe(CONFETTI_PARITY);
});
