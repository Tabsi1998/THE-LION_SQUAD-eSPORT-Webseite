import { buildSrcSet, isResizableUpload, sizedUpload, variantWidthFor, VARIANT_WIDTHS, widthsForDisplay, widthsForScreen } from "./imageVariants";

// Die Bilder trugen bereits ein sizes-Attribut, aber kein srcset. Ohne srcset
// ist sizes wirkungslos: der Browser hat nur eine Fassung zur Auswahl - die
// gespeicherte, bis zu 4096 Pixel breit, fuer eine Kachel die rund 400 zeigt.

describe("Bildvarianten", () => {
  test("eigene Uploads lassen sich verkleinern", () => {
    expect(isResizableUpload("/api/static/uploads/foto.webp")).toBe(true);
    expect(isResizableUpload("/uploads/foto.jpg")).toBe(true);
    expect(isResizableUpload("https://lionsquad.at/api/static/uploads/foto.png")).toBe(true);
  });

  test("fremde und eingebettete Bilder bleiben unangetastet", () => {
    expect(isResizableUpload("https://cdn.fremd.example/foto.jpg")).toBe(false);
    expect(isResizableUpload("data:image/png;base64,AAAA")).toBe(false);
    expect(isResizableUpload("blob:http://localhost/abc")).toBe(false);
    expect(isResizableUpload("")).toBe(false);
    expect(isResizableUpload(null)).toBe(false);
  });

  test("Videos und andere Dateien bekommen kein srcset", () => {
    expect(isResizableUpload("/api/static/uploads/clip.mp4")).toBe(false);
    expect(isResizableUpload("/api/static/uploads/regeln.pdf")).toBe(false);
    expect(buildSrcSet("/api/static/uploads/clip.mp4")).toBeUndefined();
  });

  test("das srcset nennt jede vorgehaltene Breite mit ihrer Groesse", () => {
    const set = buildSrcSet("/api/static/uploads/foto.webp");

    expect(set).toBe(
      "/api/static/uploads/foto.webp?w=160 160w, "
      + "/api/static/uploads/foto.webp?w=320 320w, "
      + "/api/static/uploads/foto.webp?w=400 400w, "
      + "/api/static/uploads/foto.webp?w=800 800w, "
      + "/api/static/uploads/foto.webp?w=1600 1600w"
    );
    VARIANT_WIDTHS.forEach((width) => expect(set).toContain(`w=${width}`));
  });

  test("eine vorhandene Abfrage wird angehaengt statt ueberschrieben", () => {
    const set = buildSrcSet("/api/static/uploads/foto.webp?v=3");

    expect(set).toContain("/api/static/uploads/foto.webp?v=3&w=400 400w");
  });

  test("nur die gewuenschten Breiten werden angeboten", () => {
    expect(buildSrcSet("/api/static/uploads/foto.webp", [400])).toBe(
      "/api/static/uploads/foto.webp?w=400 400w"
    );
  });

  // #1227: Profilbilder und Logos bekommen nur die Breiten angeboten, die zu ihrer Anzeige passen.
  test("eine kleine Anzeige bekommt nur kleine Fassungen angeboten", () => {
    expect(VARIANT_WIDTHS).toEqual([160, 320, 400, 800, 1600]);
    for (const px of [24, 32, 40, 48]) expect(widthsForDisplay(px)).toEqual([160]);
    expect(widthsForDisplay(96)).toEqual([160, 320]);
    expect(widthsForDisplay(183)).toEqual([160, 320, 400, 800]);
    expect(widthsForDisplay(800)).toEqual(VARIANT_WIDTHS);
    expect(widthsForDisplay(0)).toEqual(VARIANT_WIDTHS);
  });

  test("die passende einzelne Fassung für Gerätepixel", () => {
    expect(variantWidthFor(96)).toBe(160);
    expect(variantWidthFor(161)).toBe(320);
    expect(variantWidthFor(480)).toBe(800);
    expect(variantWidthFor(5000)).toBe(1600);
  });

  test("eine feste Breite hängt sich an eigene Uploads, sonst bleibt die Adresse", () => {
    expect(sizedUpload("/api/static/uploads/logo.png", 320)).toBe("/api/static/uploads/logo.png?w=320");
    expect(sizedUpload("/api/static/uploads/logo.png?v=2#x", 160)).toBe("/api/static/uploads/logo.png?v=2&w=160#x");
    expect(sizedUpload("/api/static/uploads/logo.png?w=400", 160)).toBe("/api/static/uploads/logo.png?w=400");
    expect(sizedUpload("https://cdn.fremd.example/logo.png", 160)).toBe("https://cdn.fremd.example/logo.png");
    expect(sizedUpload("/api/static/uploads/logo.svg", 160)).toBe("/api/static/uploads/logo.svg");
  });

  test("am Handy höchstens bis zur doppelten Bildschirmbreite, am PC alles", () => {
    expect(widthsForScreen(VARIANT_WIDTHS, 390)).toEqual([160, 320, 400, 800]);
    expect(widthsForScreen(VARIANT_WIDTHS, 768)).toEqual(VARIANT_WIDTHS);
    expect(widthsForScreen(VARIANT_WIDTHS, 1440)).toEqual(VARIANT_WIDTHS);
    expect(widthsForScreen([160], 390)).toEqual([160]);
    expect(widthsForScreen(VARIANT_WIDTHS, 0)).toEqual(VARIANT_WIDTHS);
  });
});
