// Lesbar aus 5 Metern (#1111): die Größen-Rechnung der TV-Seiten.
import {
  TV_LIMITS,
  TV_SCALES,
  bracketCardUnits,
  bracketColumnWidths,
  charsPerLine,
  chunkByUnits,
  columnsFor,
  fitItems,
  footerLines,
  minFontPx,
  nameFit,
  tvCssVars,
  tvScale,
  tvUnitPx,
  wrapLines,
} from "./tvType";

test("keine Größe liegt unter der Grenze - „groß“ hebt alle Untergrenzen um die Hälfte an", () => {
  for (const size of ["normal", "large"]) {
    const scale = TV_SCALES[size];
    const limits = TV_LIMITS[size];
    expect(scale.nameMin).toBeGreaterThanOrEqual(limits.name);
    expect(scale.name).toBeGreaterThanOrEqual(scale.nameMin);
    for (const key of ["meta", "info", "num", "head", "title", "hero"]) expect(scale[key]).toBeGreaterThanOrEqual(limits.other);
    // Zahlen, Zeiten und Stationen eher größer als die Nebensachen.
    expect(scale.info).toBeGreaterThan(scale.meta);
    expect(scale.num).toBeGreaterThan(scale.name);
  }
  expect(TV_LIMITS.large.name).toBe(TV_LIMITS.normal.name * 1.5);
  expect(TV_LIMITS.large.other).toBeCloseTo(TV_LIMITS.normal.other * 1.5);
  expect(tvScale("large")).toBe(TV_SCALES.large);
  expect(tvScale("irgendwas")).toBe(TV_SCALES.normal);
});

test("in Pixeln: 22 px für Namen und 15 px für Nebensachen bei Full HD, alles wächst mit dem Bildschirm", () => {
  expect(Math.round(minFontPx("name", "normal", 1080))).toBe(22);
  expect(Math.round(minFontPx("other", "normal", 1080))).toBe(15);
  expect(minFontPx("name", "normal", 2160)).toBeCloseTo(43.2);
  expect(minFontPx("other", "large", 720)).toBeCloseTo(15.12);
  // Eine Einheit ist 1 % der Höhe - bei sehr schmalen Bildschirmen etwas weniger.
  expect(tvUnitPx(1920, 1080)).toBeCloseTo(10.8);
  expect(tvUnitPx(3840, 2160)).toBeCloseTo(21.6);
  expect(tvUnitPx(1080, 1920)).toBeCloseTo(8.1);
});

test("CSS bekommt jede Zahl genau einmal - Schrift, Abstände, Zeilenhöhe", () => {
  const vars = tvCssVars("large");
  expect(vars["--tv-k-meta"]).toBe("2.1");
  expect(vars["--tv-k-nameMin"]).toBe("3");
  expect(vars["--tv-b-avatar"]).toBeDefined();
  expect(vars["--tv-lh-name"]).toBeDefined();
  expect(tvCssVars("normal")["--tv-k-meta"]).toBe("1.4");
});

test("Umbruch nach Wörtern, lange Wörter brechen mitten drin", () => {
  expect(wrapLines("", 10)).toBe(0);
  expect(wrapLines("Max", 10)).toBe(1);
  expect(wrapLines("Der unglaublich lange Spielername Nummer Eins", 25)).toBe(2);
  expect(wrapLines("Donaudampfschifffahrtsgesellschaft", 10)).toBe(4);
  expect(charsPerLine(10, 2)).toBe(10);
  expect(footerLines(["Station 1", "geplant ca. 14:20 · 30 Minuten"], 60)).toBe(1);
  expect(footerLines(["Station 1", "geplant ca. 14:20 · 30 Minuten"], 30)).toBe(2);
  expect(footerLines([], 30)).toBe(0);
});

test("lange Namen: erst kleiner, nie unter die Grenze, dann zweizeilig - nie „…“", () => {
  const scale = TV_SCALES.normal;
  expect(nameFit("Max", 30, scale)).toEqual({ size: scale.name, lines: 1, small: false });
  const longer = nameFit("Lions Academy Nachwuchs Team", 30, scale);
  expect(longer.size).toBe(scale.nameMin);
  expect(longer.lines).toBe(1);
  const longest = nameFit("Der unglaublich lange Spielername Nummer Eins", 30, scale);
  expect(longest).toEqual({ size: scale.nameMin, lines: 2, small: true });
  expect(longest.size).toBeGreaterThanOrEqual(TV_LIMITS.normal.name);
});

test("so viele Karten je Spalte, wie ohne Abschneiden passen", () => {
  expect(chunkByUnits([5, 5, 5, 5], 16, (item) => item, 1)).toEqual([[5, 5], [5, 5]]);
  expect(chunkByUnits([20, 3], 10, (item) => item)).toEqual([[20], [3]]);
  expect(chunkByUnits([], 10, (item) => item)).toEqual([]);
  expect(fitItems([4, 4, 4], 13, (item) => item, 0, 2)).toEqual({ shown: [4, 4, 4], hidden: 0 });
  // Passt nicht alles, bleibt Platz für „+ N weitere“.
  expect(fitItems([4, 4, 4, 4], 13, (item) => item, 0, 2)).toEqual({ shown: [4, 4], hidden: 2 });
});

test("Spalten: vier bei 16:9, weniger auf schmalen Bildschirmen und mit großer Schrift", () => {
  expect(columnsFor(173, "normal")).toBe(4);
  expect(columnsFor(173, "large")).toBe(3);
  expect(columnsFor(130, "normal")).toBe(3);
  expect(columnsFor(60, "normal")).toBe(1);
});

test("eine Karte mit zweizeiligem Namen und Station ist höher als eine kurze", () => {
  const widths = bracketColumnWidths(42.7, "normal");
  const short = bracketCardUnits({ labels: ["Max", "Turbo Tiger"], footer: ["geplant ca. 14:20 · 30 Minuten"] }, widths, "normal");
  const long = bracketCardUnits({ labels: ["Der unglaublich lange Spielername Nummer Eins", "Max"], footer: ["Station 1 – Switch 2", "geplant ca. 10.10. 14:20 · 30 Minuten"] }, widths, "normal");
  expect(long).toBeGreaterThan(short);
  const large = bracketCardUnits({ labels: ["Max", "Turbo Tiger"], footer: ["geplant ca. 14:20 · 30 Minuten"] }, bracketColumnWidths(57, "large"), "large");
  expect(large).toBeGreaterThan(short);
});
