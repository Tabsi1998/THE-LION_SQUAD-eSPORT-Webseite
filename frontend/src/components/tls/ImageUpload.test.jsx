import { cropAspectForMode, initialCropMode, SVG_REFUSED_MESSAGE, unsupportedImageMessage } from "./ImageUpload";

// Zuschnitt wie in der App (#1153): Profilbild rund (quadratischer Zuschnitt, runde Vorschau), Logo quadratisch,
// Banner 3:1 - dieselben Formate wie `IMAGE_ASPECT` in mobile/src/components/ImagePickField.tsx.

test("Formate: Banner 3:1, quadratisch 1:1, die alten Formate bleiben", () => {
  expect(cropAspectForMode("banner")).toBe(3);
  expect(cropAspectForMode("square")).toBe(1);
  expect(cropAspectForMode("wide")).toBeCloseTo(16 / 9);
  expect(cropAspectForMode("portrait")).toBeCloseTo(0.8);
  expect(cropAspectForMode("original")).toBeNull();
});

test("Beginn des Zuschnitts je Stelle: Profilbild und Logo quadratisch, Banner 3:1, sonst wie bisher", () => {
  expect(initialCropMode("square", "round")).toBe("square");
  expect(initialCropMode("square", "square")).toBe("square");
  expect(initialCropMode("wide", "banner")).toBe("banner");
  expect(initialCropMode("square", undefined)).toBe("square");
  expect(initialCropMode("wide", undefined)).toBe("original");
});

test("App und Web nennen dieselben Formate", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const app = readFileSync(path.join(process.cwd(), "../mobile/src/components/ImagePickField.tsx"), "utf8");
  expect(app).toContain("IMAGE_ASPECT: Record<ImageShape, [number, number]> = { round: [1, 1], square: [1, 1], banner: [3, 1] }");
});

// SVG (#1419): eine eigene Meldung statt „Nur PNG, JPG oder WebP“, gleicher Wortlaut wie am Server.
test("SVG bekommt die klare Meldung, andere Dateien die alte", () => {
  expect(unsupportedImageMessage({ name: "logo.svg", type: "image/svg+xml" })).toBe(SVG_REFUSED_MESSAGE);
  expect(unsupportedImageMessage({ name: "LOGO.SVG", type: "" })).toBe(SVG_REFUSED_MESSAGE);
  expect(unsupportedImageMessage({ name: "logo", type: "image/svg+xml" })).toBe(SVG_REFUSED_MESSAGE);
  expect(unsupportedImageMessage({ name: "film.gif", type: "image/gif" })).toBe("Nur PNG, JPG oder WebP erlaubt.");
  expect(SVG_REFUSED_MESSAGE).toContain("PNG");
});

test("Das Feld bietet nur PNG, JPG und WebP an und sagt, dass SVG nicht geht", async () => {
  const { readFileSync } = await import("node:fs");
  const path = await import("node:path");
  const source = readFileSync(path.join(process.cwd(), "src/components/tls/ImageUpload.jsx"), "utf8");
  expect(source).toContain('accept="image/png,image/jpeg,image/webp"');
  expect(source).toContain("SVG geht nicht.");
});
