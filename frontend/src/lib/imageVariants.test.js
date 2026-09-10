import { buildSrcSet, isResizableUpload, VARIANT_WIDTHS } from "./imageVariants";

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
      "/api/static/uploads/foto.webp?w=400 400w, "
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
});
