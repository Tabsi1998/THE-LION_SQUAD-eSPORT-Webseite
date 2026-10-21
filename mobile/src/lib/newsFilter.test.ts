import { newsCategoryCounts, newsCategoryKey } from "./newsFilter";

// Filterzeile der News (#1946, wie NewsFilterRow im Web, #1249): nur Kategorien mit Beiträgen, je mit Anzahl, in der
// Reihenfolge des Servers (Verein, Turniere, Events …), unbekannte Kategorien dahinter nach Namen.

test("nur genutzte Kategorien, mit Anzahl, in der Reihenfolge des Servers", () => {
  const rows = newsCategoryCounts([
    { category: "events" },
    { category: "club" },
    { category: "Events " },
    { category: "video" },
    { category: "" },
    { category: null },
    { category: "tournaments" },
    { category: "aaa_neu" },
  ]);
  expect(rows).toEqual([
    { key: "club", label: "Verein", count: 1 },
    { key: "tournaments", label: "Turniere", count: 1 },
    { key: "events", label: "Events", count: 2 },
    { key: "aaa_neu", label: "Aaa neu", count: 1 },
    { key: "video", label: "Video", count: 1 },
  ]);
});

test("die gewählte Kategorie bleibt sichtbar, auch wenn gerade nichts darin steht", () => {
  expect(newsCategoryCounts([{ category: "club" }], "recap")).toEqual([
    { key: "club", label: "Verein", count: 1 },
    { key: "recap", label: "Rückblick", count: 0 },
  ]);
  expect(newsCategoryCounts([])).toEqual([]);
});

test("Schlüssel einer Kategorie: klein und ohne Leerraum", () => {
  expect(newsCategoryKey(" Club ")).toBe("club");
  expect(newsCategoryKey(undefined)).toBe("");
});
