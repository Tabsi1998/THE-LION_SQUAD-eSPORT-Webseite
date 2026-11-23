import { COLUMN_ROWS, FINALE_TIMING, finaleColumns, finalePage, moreText, nameFit, rowDelay, rowLabel, rowMeta, rowUnits, targetText, columnWeight } from "./tvFinale";

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

test("columnWeight: lange Namen und lange Ziel-Ligen zählen eine halbe Zeile mehr - die Spalte bleibt über der Fußleiste", () => {
  const plain = { rows: Array.from({ length: 8 }, (_, index) => ({ name: `Team ${index}`, move: "down", target: "Liga 3" })) };
  expect(columnWeight(plain)).toBe(8);
  const heavy = { rows: [...plain.rows.slice(0, 6), { name: "x".repeat(40), move: "down", target: "Liga 3" },
    { name: "Kurz", move: "up", target: "Liga 1 - Meisterklasse der Probe-Liga" }] };
  expect(columnWeight(heavy)).toBe(9);
  expect(rowUnits(columnWeight(heavy))).toBeLessThan(rowUnits(8));
});
