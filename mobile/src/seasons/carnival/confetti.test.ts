import { hashString, mulberry32 } from "../rng";
import { GRAVITY, SHAPES, burstPieces, confettiWind, pieceAt, rainPieces, type Shape } from "./confetti";

// Konfetti mit eigener Physik in der App (F1 #745): dieselbe Rechnung wie im Web - derselbe Fingerabdruck wie in
// frontend/src/seasons/carnival/confetti.test.js. Formen verhalten sich verschieden, nichts fällt im Gleichschritt.

const CONFETTI_PARITY = 1776546414;
const SIZE = { width: 1280, height: 800 };

test("Endgeschwindigkeit je Form: Streifen fallen schneller als Punkte; Papierfetzen flattern am meisten", () => {
  const fall = (shape: Shape) => GRAVITY / SHAPES[shape].drag;
  expect(fall("strip")).toBeGreaterThan(fall("square"));
  expect(fall("square")).toBeGreaterThan(fall("dot"));
  expect(SHAPES.scrap.flutter).toBeGreaterThan(SHAPES.strip.flutter);
});

test("nichts im Gleichschritt: nach drei Sekunden weit auseinander, alle Formen dabei, Start oberhalb und früh", () => {
  const pieces = rainPieces(mulberry32(7), SIZE, 120);
  const ys = pieces.map((piece) => pieceAt(piece, 3)?.y ?? 0);
  expect(Math.max(...ys) - Math.min(...ys)).toBeGreaterThan(200);
  expect(new Set(pieces.map((piece) => piece.shape))).toEqual(new Set(["square", "strip", "dot", "scrap"]));
  pieces.forEach((piece) => {
    expect(piece.y).toBeLessThan(0);
    expect(piece.at).toBeLessThanOrEqual(2500);
  });
});

test("Explosion: erst nach oben, dann rieselt es herab; der Wind trägt zur Seite", () => {
  const pieces = burstPieces(mulberry32(11), { x: 400, y: 300 }, 40);
  expect(pieces.filter((piece) => (pieceAt(piece, 0.15)?.y ?? 999) < 300).length).toBeGreaterThan(30);
  expect(pieces.every((piece) => (pieceAt(piece, 4)?.y ?? 0) > 300)).toBe(true);
  expect((pieceAt(pieces[0], 4, 60)?.x ?? 0)).toBeGreaterThan((pieceAt(pieces[0], 4, 0)?.x ?? 0) + 100);
  expect(pieceAt(pieces[0], -0.1)).toBeNull();
  expect(confettiWind(null)).toBe(0);
  expect(confettiWind({ wind_factor: 0.5, wind_dir: 270 })).toBeCloseTo(35, 0);
});

test("Parität mit dem Web: derselbe Fingerabdruck für Regen, Explosion und Bahnen", () => {
  const rain = rainPieces(mulberry32(2027), SIZE, 24);
  const burst = burstPieces(mulberry32(42), { x: 300, y: 200 }, 12);
  const paths = [...rain, ...burst].map((piece) => [0, 0.4, 1.3, 2.7].map((t) => pieceAt(piece, t, 25)));
  expect(hashString(JSON.stringify({ rain, burst, paths }))).toBe(CONFETTI_PARITY);
});
