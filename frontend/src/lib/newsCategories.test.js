import { newsCategoryLabel } from "./newsCategories";

describe("News-Kategorien", () => {
  test("Kategorien auf Deutsch", () => {
    expect(newsCategoryLabel("events")).toBe("Events");
    expect(newsCategoryLabel("announcement")).toBe("Ankündigung");
    expect(newsCategoryLabel("Recap")).toBe("Rückblick");
  });

  test("Unbekanntes wird lesbar, Leeres bleibt leer", () => {
    expect(newsCategoryLabel("press_release")).toBe("Press release");
    expect(newsCategoryLabel("")).toBe("");
    expect(newsCategoryLabel(undefined)).toBe("");
  });
});
