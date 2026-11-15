// Galerie-Raster (#936): wie breit eine Kachel wirklich ist, damit der Browser die passende Fassung aus dem srcset
// nimmt. Die Zahlen folgen den Klassen in GalleryAlbumPage.jsx bzw. GalleryPage.jsx - ändert sich dort das Raster,
// gehört es hier mitgeändert (gallerySizes.test.js rechnet beide Seiten gegeneinander nach).

/** Container der öffentlichen Seiten: max-w-7xl (112rem) mit px-4 / sm:px-6 / lg:px-8. */
export const PAGE_MAX_WIDTH = 1792;
export function pagePadding(viewport) {
  if (viewport >= 1024) return 32;
  if (viewport >= 640) return 24;
  return 16;
}

/** Album: columns-2 sm:columns-3 xl:columns-4, gap-3 (12 px). */
export const ALBUM_GRID = { gap: 12, columns: (viewport) => (viewport >= 1280 ? 4 : viewport >= 640 ? 3 : 2) };

/** Album-Übersicht: grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5, gap-5 (20 px). */
export const ALBUM_LIST_GRID = {
  gap: 20,
  columns: (viewport) => (viewport >= 1536 ? 5 : viewport >= 1024 ? 4 : viewport >= 768 ? 3 : viewport >= 640 ? 2 : 1),
};

/** Tatsächliche Breite einer Kachel in CSS-Pixeln. */
export function tileWidth(grid, viewport) {
  const columns = grid.columns(viewport);
  const content = Math.min(viewport, PAGE_MAX_WIDTH) - 2 * pagePadding(viewport);
  return (content - (columns - 1) * grid.gap) / columns;
}

// Rand links und rechts plus Lücken je Stufe: (100vw - Abzug) / Spalten; ab 1792 px steht der Container still.
export const GALLERY_ALBUM_GRID_SIZES = [
  "(min-width: 1792px) 423px",
  "(min-width: 1280px) calc((100vw - 100px) / 4)",
  "(min-width: 1024px) calc((100vw - 88px) / 3)",
  "(min-width: 640px) calc((100vw - 72px) / 3)",
  "calc((100vw - 44px) / 2)",
].join(", ");

export const GALLERY_LIST_GRID_SIZES = [
  "(min-width: 1792px) 329px",
  "(min-width: 1536px) calc((100vw - 144px) / 5)",
  "(min-width: 1024px) calc((100vw - 124px) / 4)",
  "(min-width: 768px) calc((100vw - 88px) / 3)",
  "(min-width: 640px) calc((100vw - 68px) / 2)",
  "calc(100vw - 32px)",
].join(", ");
