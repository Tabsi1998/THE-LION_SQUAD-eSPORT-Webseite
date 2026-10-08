import { cropAspectForMode, initialCropMode } from "./ImageUpload";

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
