// Die Katze am Handy (Rückmeldung des Betreibers, 02.10.2026: „die Katze sieht man am Handy nicht“): auf schmalen
// Fenstern ist die Fußzeile eng, deshalb sucht sie sich auf dem Strich über dem Impressum eine Stelle, über der weder
// Text noch Link noch Symbol liegt - und läuft nur innerhalb dieses freien Stücks. Reine Rechnung mit Rechtecken.

/** Was über dem Strich frei bleiben muss - wie beim Nikolausstiefel. */
export const CAT_BLOCKERS = "a, button, img, svg, input, select, textarea, p, span, li, h1, h2, h3, h4, h5, h6";
/** Höchstens so groß am Handy; Abstand zum Rand des Platzes. */
export const PHONE_CAT_SIZE = 52;
const EDGE = 8;
const STEP = 4;

/**
 * Freie Stelle auf dem Strich: `line` und `slot` als Fensterrechtecke, `blockers` die Rechtecke der Fußzeile, `size`
 * die Größe der Katze, `startX` die gewürfelte Stelle (Koordinaten des Platzes). Ergebnis `{ x, min, max }` in
 * Koordinaten des Platzes - `x` möglichst nah an `startX`, `min`/`max` das freie Stück, in dem sie laufen darf -
 * oder null, wenn nirgends Platz ist.
 */
export function catSpot({ line, slot, blockers = [], size, startX = 40 }) {
  if (!line || !slot || !(slot.width > 0)) return null;
  const top = line.top - size * 0.92;
  const free = (x) => {
    const left = slot.left + x;
    return blockers.every((rect) => !(rect.width > 0 && rect.height > 0 && rect.right > left + 2 && rect.left < left + size - 2 && rect.bottom > top + 2 && rect.top < line.top - 1));
  };
  const spans = [];
  let open = null;
  for (let x = EDGE; x <= slot.width - size - EDGE; x += STEP) {
    if (free(x)) {
      if (open === null) open = x;
    } else if (open !== null) {
      spans.push({ min: open, max: x - STEP });
      open = null;
    }
  }
  if (open !== null) spans.push({ min: open, max: Math.floor((slot.width - size - EDGE) / STEP) * STEP });
  if (!spans.length) return null;
  const distance = (span) => (startX < span.min ? span.min - startX : startX > span.max ? startX - span.max : 0);
  const best = spans.reduce((pick, span) => (distance(span) < distance(pick) || (distance(span) === distance(pick) && span.max - span.min > pick.max - pick.min) ? span : pick));
  return { x: Math.min(best.max, Math.max(best.min, startX)), min: best.min, max: best.max };
}

/** Wohin sie am Handy läuft: innerhalb des freien Stücks, mindestens 40 px weit - sonst bleibt sie sitzen. */
export function phoneCatTarget(current, spot, rng = Math.random) {
  if (!spot || spot.max - spot.min < 40) return current;
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const x = Math.round(spot.min + rng() * (spot.max - spot.min));
    if (Math.abs(x - current) >= 40) return x;
  }
  return current - spot.min > spot.max - current ? spot.min : spot.max;
}
