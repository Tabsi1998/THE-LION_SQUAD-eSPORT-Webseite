// Galerie (#1079): Geometrie für das große Bild, das aus seiner Kachel wächst und beim Schließen dorthin zurückfliegt.
//
// `flyTransform(stage, tile, media)` liefert Verschiebung und Maßstab für die Bühne (Drehpunkt in ihrer Mitte), mit
// denen das Bild darin genau auf der Kachel liegt. `media` ist das Bild in der Bühne; fehlt es (noch nicht geladen),
// zählt die ganze Bühne. Ohne Maße gibt es nichts zu fliegen (`null`).

function measured(rect) {
  return Boolean(rect) && rect.width > 0 && rect.height > 0;
}

export function flyTransform(stage, tile, media = stage) {
  if (!measured(stage) || !measured(tile)) return null;
  const box = measured(media) ? media : stage;
  const scale = Math.max(0.05, Math.min(tile.width / box.width, tile.height / box.height));
  const cx = stage.left + stage.width / 2;
  const cy = stage.top + stage.height / 2;
  const mx = box.left + box.width / 2;
  const my = box.top + box.height / 2;
  return {
    dx: tile.left + tile.width / 2 - cx - scale * (mx - cx),
    dy: tile.top + tile.height / 2 - cy - scale * (my - cy),
    scale,
  };
}

// Liegt die Kachel (auch nur teilweise) im sichtbaren Fenster?
export function inViewport(rect, width, height) {
  return measured(rect) && rect.bottom > 0 && rect.right > 0 && rect.top < height && rect.left < width;
}
