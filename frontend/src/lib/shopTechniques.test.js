import { defaultTechnique, techniqueHint, techniqueLabel, techniqueList } from "./shopTechniques";

// Drucktechniken (#2091): deutsche Namen, kurze Erklärung, sinnvolle Vorgabe.

test("bekannte Schlüssel bekommen Namen und Erklärung, unbekannte bleiben stehen", () => {
  expect(techniqueLabel("dtg")).toBe("DTG-Direktdruck");
  expect(techniqueLabel("dtfilm")).toBe("DTF-Transfer (DTFlex)");
  expect(techniqueLabel("embroidery")).toBe("Stickerei");
  expect(techniqueHint("dtg")).toMatch(/helle Shirts/);
  expect(techniqueHint("dtfilm")).toMatch(/dunklen Shirts/);
  expect(techniqueHint("embroidery")).toMatch(/kleine Flächen/);
  expect(techniqueLabel("laser")).toBe("laser");
  expect(techniqueHint("laser")).toBe("");
  expect(techniqueList(["dtg", "dtfilm", "laser"])).toBe("DTG-Direktdruck, DTF-Transfer (DTFlex), laser");
  expect(techniqueList(undefined)).toBe("");
});

test("Vorgabe: gespeicherte Wahl, dann Standard von Printful, dann Direktdruck vor Transfer vor Stickerei", () => {
  const all = { techniques: ["embroidery", "dtfilm", "dtg"], default_technique: null };
  expect(defaultTechnique(all)).toBe("dtg");
  expect(defaultTechnique({ techniques: ["embroidery", "dtfilm"] })).toBe("dtfilm");
  expect(defaultTechnique({ ...all, default_technique: "embroidery" })).toBe("embroidery");
  expect(defaultTechnique({ ...all, default_technique: "sublimation" })).toBe("dtg");
  expect(defaultTechnique(all, "dtfilm")).toBe("dtfilm");
  expect(defaultTechnique({ techniques: ["digital"] })).toBe("digital");
  expect(defaultTechnique(null)).toBe("");
});
