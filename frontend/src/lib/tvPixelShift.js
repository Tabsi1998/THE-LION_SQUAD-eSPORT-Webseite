// Pixel-Verschiebung (#1112): Alle paar Minuten wandert das ganze Bild um 1 bis 3 Punkte - zu wenig, um es zu
// sehen, genug, damit Logo und Linien sich nicht ins Panel brennen. Weil man es nicht sieht, gilt sie auch mit
// „Bewegung reduzieren“. Der Weg bleibt im Umkreis von 3 Punkten (nie 4), ein Schritt springt ohne Gleiten.

export const PIXEL_SHIFT_MS = 3 * 60 * 1000;
export const PIXEL_SHIFT_MAX = 3;

export const PIXEL_SHIFT_PATH = Object.freeze([
  [0, 0], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1],
  [2, -1], [2, 1], [1, 2], [-1, 2], [-2, 1], [-2, -1], [-1, -2], [1, -2],
  [3, 0], [2, 2], [0, 3], [-2, 2], [-3, 0], [-2, -2], [0, -3], [2, -2],
].map((point) => Object.freeze(point)));

/** Die Verschiebung im Schritt `step` (läuft im Kreis). */
export function pixelShiftAt(step) {
  const length = PIXEL_SHIFT_PATH.length;
  const index = ((Math.floor(Number(step) || 0) % length) + length) % length;
  return PIXEL_SHIFT_PATH[index];
}
