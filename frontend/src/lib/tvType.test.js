// Lesbar aus 5 Metern (#1111): die Größen-Rechnung der TV-Seiten.
import {
  TV_LIMITS,
  TV_SCALES,
  charsPerLine,
  fitItems,
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

test("so viele Einträge, wie ohne Abschneiden passen - sonst „+ N weitere“", () => {
  expect(fitItems([4, 4, 4], 13, (item) => item, 0, 2)).toEqual({ shown: [4, 4, 4], hidden: 0 });
  // Passt nicht alles, bleibt Platz für „+ N weitere“.
  expect(fitItems([4, 4, 4, 4], 13, (item) => item, 0, 2)).toEqual({ shown: [4, 4], hidden: 2 });
});

test("Turnierbaum auf der Bühne (#1115): feste Einheit, und verkleinert halten Namen und Nebensachen die Grenze", async () => {
  const { TV_STAGE_UNIT_PX, TV_TREE_SCALES, stageBase, treeCssVars, treeMinZoom } = await import("./tvType");
  expect(TV_STAGE_UNIT_PX).toBe(10.8);
  for (const size of ["normal", "large"]) {
    const scale = TV_TREE_SCALES[size];
    const limits = TV_LIMITS[size];
    const zoom = treeMinZoom(size);
    expect(zoom).toBeLessThan(1);
    expect(scale.name * zoom).toBeGreaterThanOrEqual(limits.name - 1e-9);
    expect(scale.nameMin * zoom).toBeGreaterThanOrEqual(limits.name - 1e-9);
    for (const key of ["meta", "info", "num", "head"]) expect(scale[key] * zoom).toBeGreaterThanOrEqual(limits.other - 1e-9);
  }
  expect(treeMinZoom("large")).toBeGreaterThan(treeMinZoom("normal"));
  expect(treeCssVars("normal")["--tv-u"]).toBe("10.8px");
  expect(treeCssVars("large")["--tv-k-name"]).toBe("3.6");
  // Bei 720p, 1080p und 4K wirkt die Bühne gleich groß: 1080 Bühnen-Punkte füllen die Höhe.
  for (const [width, height] of [[1280, 720], [1920, 1080], [3840, 2160]]) expect(stageBase(width, height) * 1080).toBeCloseTo(height);
});
