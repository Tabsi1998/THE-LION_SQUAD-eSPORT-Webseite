import { readFileSync } from "node:fs";
import path from "node:path";
import { VARIANT_WIDTHS } from "@/lib/imageVariants";
import { ALBUM_GRID, ALBUM_LIST_GRID, GALLERY_ALBUM_GRID_SIZES, GALLERY_LIST_GRID_SIZES, tileWidth } from "./gallerySizes";

// Galerie-sizes (#936): Der Browser wählt die Fassung aus dem srcset nach `sizes` mal Pixeldichte. Stimmt `sizes`
// nicht mit der echten Kachelbreite überein, lädt etwa ein Handy mit 390 px für eine halbe Spalte die 800er Fassung.

/** Wertet unsere sizes-Formen aus: "(min-width: Npx) Wert", Wert = "Npx" | "calc((100vw - Npx) / K)" | "Nvw". */
function evaluateSizes(sizes, viewport) {
  for (const entry of sizes.split(", ")) {
    const media = entry.match(/^\(min-width: (\d+)px\) (.+)$/);
    if (media && viewport < Number(media[1])) continue;
    const value = media ? media[2] : entry;
    const px = value.match(/^(\d+)px$/);
    if (px) return Number(px[1]);
    const calc = value.match(/^calc\(\(100vw - (\d+)px\) \/ (\d+)\)$/);
    if (calc) return (viewport - Number(calc[1])) / Number(calc[2]);
    const single = value.match(/^calc\(100vw - (\d+)px\)$/);
    if (single) return viewport - Number(single[1]);
    const vw = value.match(/^(\d+)vw$/);
    if (vw) return (viewport * Number(vw[1])) / 100;
    throw new Error(`Unbekannte sizes-Angabe: ${value}`);
  }
  throw new Error("sizes ohne Rückfallwert");
}

const pick = (cssWidth, dpr) => VARIANT_WIDTHS.find((width) => width >= cssWidth * dpr) || VARIANT_WIDTHS.at(-1);
const source = (file) => readFileSync(path.resolve(__dirname, "../pages/public", file), "utf8");

describe.each([
  ["Album-Raster", ALBUM_GRID, GALLERY_ALBUM_GRID_SIZES],
  ["Album-Übersicht", ALBUM_LIST_GRID, GALLERY_LIST_GRID_SIZES],
])("%s", (_label, grid, sizes) => {
  it.each([390, 640, 768, 1024, 1280, 1536, 1920])("sizes entspricht bei %i px der echten Kachelbreite", (viewport) => {
    expect(Math.abs(evaluateSizes(sizes, viewport) - tileWidth(grid, viewport))).toBeLessThan(1);
  });

  it.each([[390, 1], [390, 2], [640, 1], [640, 2], [768, 1], [768, 2], [1280, 1], [1280, 2]])(
    "bei %i px und Pixeldichte %i wählt der Browser die kleinste scharfe Fassung",
    (viewport, dpr) => {
      expect(pick(evaluateSizes(sizes, viewport), dpr)).toBe(pick(tileWidth(grid, viewport), dpr));
    },
  );
});

test("die Rechnung folgt den Klassen der Seiten", () => {
  expect(source("GalleryAlbumPage.jsx")).toContain('className="columns-2 sm:columns-3 xl:columns-4 gap-3"');
  expect(source("GalleryAlbumPage.jsx")).toContain("sizes={GRID_SIZES}");
  expect(source("GalleryPage.jsx")).toContain("grid sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5 gap-5");
  expect(source("GalleryPage.jsx")).toContain("sizes={GALLERY_LIST_GRID_SIZES}");
  for (const file of ["GalleryAlbumPage.jsx", "GalleryPage.jsx"]) {
    expect(source(file)).toContain('className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8');
  }
});

test("Handy mit 390 px und doppelter Pixeldichte lädt für eine halbe Spalte die 400er statt der 800er Fassung", () => {
  expect(pick(evaluateSizes(GALLERY_ALBUM_GRID_SIZES, 390), 2)).toBe(400);
});
