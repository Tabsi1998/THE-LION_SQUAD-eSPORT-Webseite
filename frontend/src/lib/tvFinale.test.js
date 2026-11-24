import { COLUMN_ROWS, FINALE_TIMING, finaleColumns, finalePage, finaleRowUnits, fitFinaleColumns, moreText, nameFit, rowDelay, rowLabel, rowMeta, rowUnits, targetText } from "./tvFinale";
import { tvScale } from "./tvType";

// Saisonfinale am TV (#1641): welche Seite dran ist, wer in welche Spalte gehört und wann jede Zeile kommt. Erfundene Namen.

const PAGES = [
  { label: "Liga 1", rows: [{ registration_id: "a", name: "Probe Süd", rank: 4, move: "down", target: "Liga 2", staffel: null }] },
  { label: "Liga 2", rows: [
    { registration_id: "b", name: "Probe Nord", rank: 1, move: "up", target: "Liga 1", staffel: "A" },
    { registration_id: "c", name: "Probe Raus", rank: 5, move: "out", target: null, staffel: "B" },
  ] },
];

test("finalePage: nur mit gültigem Schritt eine Seite, sonst nichts", () => {
  expect(finalePage(null)).toBeNull();
  expect(finalePage({ step: 0, pages: PAGES })).toBeNull();
  expect(finalePage({ step: 3, pages: PAGES })).toBeNull();
  expect(finalePage({ step: "1", pages: PAGES })).toMatchObject({ label: "Liga 1", step: 1, count: 2 });
  expect(finalePage({ step: 2, pages: PAGES })).toMatchObject({ label: "Liga 2", step: 2, count: 2 });
  expect(finalePage({ step: 1, pages: [{ label: "Liga 1", rows: [] }] })).toBeNull();
});

test("finaleColumns: links Aufstieg, rechts Abstieg mit Ausscheidenden; eine Spalte, wenn nur eine Seite da ist", () => {
  expect(finaleColumns(PAGES[1]).map((column) => [column.key, column.title, column.rows.map((row) => row.registration_id)])).toEqual([
    ["up", "Aufstieg", ["b"]], ["down", "Scheidet aus", ["c"]]]);
  expect(finaleColumns({ rows: [PAGES[0].rows[0], PAGES[1].rows[1]] })[0].title).toBe("Abstieg");
  expect(finaleColumns(PAGES[0]).map((column) => column.key)).toEqual(["down"]);
  expect(finaleColumns({ rows: [PAGES[1].rows[1]] })[0].title).toBe("Scheidet aus");
});

test("rowDelay staffelt durchgezählt, rowUnits passt die Höhe an die längste Spalte an", () => {
  expect(rowDelay(0)).toBe(FINALE_TIMING.firstRow);
  expect(rowDelay(3)).toBeCloseTo(FINALE_TIMING.firstRow + 3 * FINALE_TIMING.stagger);
  expect(rowUnits(1)).toBe(9);
  expect(rowUnits(8)).toBe(5.5);
  expect(rowUnits(40)).toBe(4);
});

test("Texte: Platz und Staffel, Ziel, Vorlesetext - lange Namen kleiner statt abgeschnitten", () => {
  expect(rowMeta(PAGES[1].rows[0])).toBe("Platz 1 · Staffel A");
  expect(rowMeta(PAGES[0].rows[0])).toBe("Platz 4");
  expect(targetText(PAGES[1].rows[0])).toBe("Liga 1");
  expect(targetText(PAGES[1].rows[1])).toBe("scheidet aus");
  expect(rowLabel(PAGES[1].rows[0])).toBe("Probe Nord steigt auf in Liga 1");
  expect(rowLabel(PAGES[0].rows[0])).toBe("Probe Süd steigt ab in Liga 2");
  expect(rowLabel(PAGES[1].rows[1])).toBe("Probe Raus scheidet aus");
  expect(nameFit("Kurz")).toBeUndefined();
  expect(nameFit("x".repeat(23))).toBe("small");
  expect(nameFit("x".repeat(35))).toBe("tiny");
});

test("Spaltenköpfe kommen aus FINALE_TIMING - nach dem Titel, vor der ersten Zeile", () => {
  expect(FINALE_TIMING.head).toBeGreaterThan(0);
  expect(FINALE_TIMING.head).toBeLessThan(FINALE_TIMING.firstRow);
});

test("Nr. 235: höchstens 8 Zeilen je Spalte, der Rest zählt je Spalte - auch zusätzlich zu dem, was der Server schon weglässt", () => {
  const up = Array.from({ length: 3 }, (_, index) => ({ registration_id: `u${index}`, move: "up" }));
  const down = Array.from({ length: 12 }, (_, index) => ({ registration_id: `d${index}`, move: index % 3 ? "down" : "out" }));
  const [left, right] = finaleColumns({ rows: [...up, ...down], more_up: 1, more_down: 2 });
  expect(COLUMN_ROWS).toBe(8);
  expect([left.key, left.rows.length, left.more]).toEqual(["up", 3, 1]);
  expect([right.key, right.rows.length, right.more]).toEqual(["down", 8, 6]);
  expect(right.rows.map((row) => row.registration_id)).toEqual(down.slice(0, 8).map((row) => row.registration_id));
  expect(moreText(6)).toBe("und 6 weitere");
  expect(moreText(1)).toBe("und 1 weiteres Team");
});

// ---------------------------------------------------------------- Runde 2 (Nr. 238): 8 Zeilen sind eine Obergrenze

const NORMAL = tvScale("normal");
const HEAVY_TARGET = "Liga 1 - Meisterklasse der Probe-Liga Oesterreich";
const heavyRow = (index, move = "up") => ({ registration_id: `h${index}`, name: `Probe Mannschaft Nummer ${index} mit sehr langem Vereinsnamen`,
  rank: 1, move, target: HEAVY_TARGET, staffel: "ABC"[index % 3] });
const shortRow = (index, move = "down") => ({ registration_id: `s${index}`, name: `Team ${index}`, rank: 4, move, target: "Liga 3", staffel: null });

test("finaleRowUnits: eine kurze Zeile kaum höher als die Grundhöhe, eine mit zweizeiligem Namen und Ziel deutlich höher", () => {
  const unit = rowUnits(8);
  // Kurz: Name und Platz in je einer Zeile - kaum mehr als die Grundhoehe (am TV gemessen gut 6 Einheiten).
  const short = finaleRowUnits(shortRow(1), { columnU: 84.7, unitU: unit, scale: NORMAL });
  expect(short).toBeGreaterThanOrEqual(unit);
  expect(short).toBeLessThanOrEqual(unit + 1);
  const heavy = finaleRowUnits(heavyRow(1), { columnU: 84.7, unitU: unit, scale: NORMAL });
  // Gemessen am TV (1920 px): knapp 10 Einheiten je Zeile (Name dreizeilig).
  expect(heavy).toBeGreaterThanOrEqual(7.6);
  expect(heavy).toBeLessThan(12);
});

test("fitFinaleColumns: acht schwere Zeilen - nur so viele, wie samt Kopf und „und N weitere“ über die Fußleiste passen", () => {
  const page = { rows: [...Array.from({ length: 8 }, (_, index) => heavyRow(index)), ...Array.from({ length: 8 }, (_, index) => heavyRow(index + 10, "down"))],
    more_up: 0, more_down: 2 };
  const area = { w: 173.4, h: 61 };
  const [up, down] = fitFinaleColumns(finaleColumns(page), { area, scale: NORMAL });
  expect(up.rows.length).toBeLessThan(8);
  expect(up.rows.length).toBeGreaterThanOrEqual(5);
  expect(up.more).toBe(8 - up.rows.length);
  expect(down.more).toBe(8 - down.rows.length + 2);
  for (const column of [up, down]) expect(column.heightU).toBeLessThanOrEqual(area.h);
});

test("fitFinaleColumns: kurze Namen - alle acht Zeilen; trim kürzt eine Spalte, falls sie am TV trotzdem überläuft", () => {
  const page = { rows: Array.from({ length: 8 }, (_, index) => shortRow(index)) };
  const area = { w: 173.4, h: 61 };
  const [down] = fitFinaleColumns(finaleColumns(page), { area, scale: NORMAL });
  expect([down.rows.length, down.more]).toEqual([8, 0]);
  const [trimmed] = fitFinaleColumns(finaleColumns(page), { area, scale: NORMAL, trim: { down: 2 } });
  expect([trimmed.rows.length, trimmed.more]).toEqual([6, 2]);
});

test("fitFinaleColumns: ohne gemessene Fläche gilt ein 16:9-Bild; nie weniger als eine Zeile", () => {
  const page = { rows: [...Array.from({ length: 8 }, (_, index) => heavyRow(index)), ...Array.from({ length: 8 }, (_, index) => heavyRow(index + 10, "down"))] };
  const [up] = fitFinaleColumns(finaleColumns(page), { area: null, scale: NORMAL });
  expect(up.rows.length).toBeGreaterThanOrEqual(5);
  expect(up.rows.length).toBeLessThan(8);
  const [tiny] = fitFinaleColumns(finaleColumns(page), { area: { w: 173.4, h: 5 }, scale: NORMAL });
  expect(tiny.rows.length).toBe(1);
});
