// Die Konfetti-Ebene in der App (Fasching F1 #745), wie layer.js im Web, aber als Worklets auf dem UI-Thread:
// `stepConfetti` schiebt die fliegenden Stücke mit dem Scrollen (sie gehören zum Screen), räumt fertige weg und lässt
// einige auf der Oberkante der Tab-Leiste kurz liegen; `drawConfetti` zeichnet mit Skia - gekippt (Vorder- und
// Rückseite), liegend flach. Erzeugt werden die Stücke auf dem JS-Thread (Regen, Explosion des Huts).

import type { SkCanvas, SkColor, SkPaint, SkPath, SkRect } from "@shopify/react-native-skia";
import { pieceAt, type Piece } from "./confetti";

/** Stücke je Gerät in der App (#643: 60) - „normal“ und „kräftig“; „dezent“ keine. */
export const APP_CONFETTI = { normal: 60, full: 100 } as const;
export const APP_BURST = 24;
export const MAX_SECONDS = 14;
export const REST_SHARE = 0.3;
export const REST_MS: [number, number] = [2200, 4200];
export const FADE_MS = 600;
/** Liegend sieht man ein Stück schräg von vorn: flach, die lange Seite waagrecht. */
export const LYING_FLIP = 0.42;

export type Flying = { piece: Piece; start: number; shift: number; rests: boolean; lastY: number | null; hold: number; tilt: number };
export type Resting = { piece: Piece; x: number; top: number; angle: number; lift: number; until: number };
export type ConfettiState = { flying: Flying[]; resting: Resting[] };
export type Ledge = { left: number; right: number; top: number };
export type Size = { width: number; height: number };
export type ConfettiKit = {
  paint: SkPaint;
  front: SkColor[];
  back: SkColor[];
  rect: (x: number, y: number, w: number, h: number) => SkRect;
  polygon: (points: Array<[number, number]>) => SkPath;
};

export function capForApp(effective: string): number {
  return effective === "full" ? APP_CONFETTI.full : effective === "normal" ? APP_CONFETTI.normal : 0;
}

export function emptyConfetti(): ConfettiState {
  "worklet";
  return { flying: [], resting: [] };
}

/** Neue Stücke (auf dem JS-Thread gewürfelt): ob ein Stück liegen bleiben darf, wie lange, wie schief - fest je Stück. */
export function flyingFrom(pieces: Piece[], now: number, rng: () => number): Flying[] {
  return pieces.map((piece) => ({ piece, start: now, shift: 0, rests: rng() < REST_SHARE, lastY: null, hold: REST_MS[0] + rng() * (REST_MS[1] - REST_MS[0]), tilt: (rng() - 0.5) * 0.36 }));
}

/** In den Zustand - nie mehr Stücke als erlaubt (fliegend und liegend zusammen). */
export function addFlying(state: ConfettiState, entries: Flying[], cap: number): ConfettiState {
  "worklet";
  const room = Math.max(0, cap - state.flying.length - state.resting.length);
  for (let i = 0; i < entries.length && i < room; i += 1) state.flying.push(entries[i]);
  return state;
}

/** Liegend: die lange Seite waagrecht, etwas schief, so hoch über der Kante wie die halbe Dicke. */
export function lying(piece: Piece, tilt: number): { piece: Piece; angle: number; lift: number } {
  "worklet";
  const long = Math.max(piece.w, piece.h);
  const short = Math.min(piece.w, piece.h);
  return { piece: { ...piece, w: long, h: short }, angle: tilt, lift: (short * LYING_FLIP) / 2 };
}

/**
 * Ein Bild weiter: `scrolled` (Punkte seit dem letzten Bild) schiebt die fliegenden Stücke mit dem Screen; wer die
 * Kante von oben kreuzt und liegen bleiben darf, liegt dort und verblasst danach; was unten hinaus ist oder zu lange
 * fliegt, fällt weg. Gibt den Zustand zurück (für `modify`).
 */
export function stepConfetti(state: ConfettiState, now: number, size: Size, wind: number, ledge: Ledge | null, scrolled = 0): ConfettiState {
  "worklet";
  const next: Flying[] = [];
  for (const item of state.flying) {
    item.shift -= scrolled;
    const t = (now - item.start - item.piece.at) / 1000;
    if (t < 0) {
      next.push(item);
      continue;
    }
    if (t > MAX_SECONDS) continue;
    const at = pieceAt(item.piece, t, wind);
    if (!at) continue;
    const y = at.y + item.shift;
    if (ledge && item.rests && item.lastY !== null && at.x >= ledge.left && at.x <= ledge.right && item.lastY < ledge.top && y >= ledge.top) {
      const flat = lying(item.piece, item.tilt);
      state.resting.push({ piece: flat.piece, x: at.x, top: ledge.top, angle: flat.angle, lift: flat.lift, until: now + item.hold });
      continue;
    }
    item.lastY = y;
    if (y > size.height + 40) continue;
    next.push(item);
  }
  state.flying = next;
  state.resting = state.resting.filter((rest) => now < rest.until + FADE_MS);
  return state;
}

/** Ist nichts mehr zu zeichnen? Dann schläft die Ebene. */
export function confettiIdle(state: ConfettiState): boolean {
  "worklet";
  return state.flying.length === 0 && state.resting.length === 0;
}

function drawPiece(canvas: SkCanvas, kit: ConfettiKit, piece: Piece, x: number, y: number, angle: number, flip: number, alpha: number) {
  "worklet";
  const colors = flip >= 0 ? kit.front : kit.back;
  kit.paint.setColor(colors[piece.color] ?? colors[0]);
  kit.paint.setAlphaf(alpha);
  canvas.save();
  canvas.translate(x, y);
  canvas.rotate((angle * 180) / Math.PI, 0, 0);
  // Kippen: nahe 0 sieht man das Stück von der Kante.
  canvas.scale(1, Math.max(0.08, Math.abs(flip)));
  const w = piece.w;
  const h = piece.h;
  if (piece.shape === "dot") {
    canvas.drawCircle(0, 0, w / 2, kit.paint);
  } else if (piece.shape === "scrap" && piece.corners) {
    const points: Array<[number, number]> = [];
    for (let index = 0; index < piece.corners.length; index += 1) {
      const turn = (index / piece.corners.length) * Math.PI * 2;
      points.push([Math.cos(turn) * (w / 2) * piece.corners[index], Math.sin(turn) * (h / 2) * piece.corners[index]]);
    }
    canvas.drawPath(kit.polygon(points), kit.paint);
  } else {
    canvas.drawRect(kit.rect(-w / 2, -h / 2, w, h), kit.paint);
  }
  canvas.restore();
}

/** Zeichnet die fliegenden Stücke (mit dem Scrollen verschoben) und die liegenden (flach, am Ende verblassend). */
export function drawConfetti(canvas: SkCanvas, state: ConfettiState, now: number, size: Size, wind: number, kit: ConfettiKit) {
  "worklet";
  for (const item of state.flying) {
    const t = (now - item.start - item.piece.at) / 1000;
    if (t < 0) continue;
    const at = pieceAt(item.piece, t, wind);
    if (!at) continue;
    const y = at.y + item.shift;
    if (y < -40 || y > size.height + 40) continue;
    drawPiece(canvas, kit, item.piece, at.x, y, at.angle, at.flip, 1);
  }
  for (const rest of state.resting) {
    const alpha = now < rest.until ? 1 : Math.max(0, 1 - (now - rest.until) / FADE_MS);
    drawPiece(canvas, kit, rest.piece, rest.x, rest.top - rest.lift, rest.angle, LYING_FLIP, alpha);
  }
}
