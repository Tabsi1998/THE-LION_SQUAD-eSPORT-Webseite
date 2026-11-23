import { FINALE_TIMING, finaleColumns, finalePage, nameFit, rowDelay, rowLabel, rowMeta, rowUnits, targetText } from "./tvFinale";

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
  expect(rowUnits(8)).toBe(6.5);
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
