import { readFileSync } from "node:fs";
import path from "node:path";
import { COLUMN_ROWS, FALLBACK_AREA, FINALE_BOX, FINALE_TIMING, TARGET_BADGE_EM, TARGET_BADGE_HEIGHT_EM, columnUnits, finaleColumns, finalePage, finaleRowUnits, fitFinaleColumns, moreText, nameFit, rowDelay, rowLabel, rowMeta, rowUnits, targetChipUnits, targetText } from "./tvFinale";
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
// Am TV gemessen (1920 px, Spalte 82,5 Einheiten): 9,81 - Name dreizeilig, Ziel-Liga zweizeilig.
const HEAVY_U = 9.87;
const HEAVY_TARGET = "Liga 1 - Meisterklasse der Probe-Liga Oesterreich";
const heavyRow = (index, move = "up") => ({ registration_id: `h${index}`, name: `Probe Mannschaft Nummer ${index} mit sehr langem Vereinsnamen`,
  rank: 1, move, target: HEAVY_TARGET, staffel: "ABC"[index % 3] });
const shortRow = (index, move = "down") => ({ registration_id: `s${index}`, name: `Team ${index}`, rank: 4, move, target: "Liga 3", staffel: null });

test("finaleRowUnits: kurze Zeile 5,9 Einheiten, schwere (Name dreizeilig, Ziel zweizeilig) 9,87 - wie am TV gemessen", () => {
  const unit = rowUnits(8);
  // Kurz: Name und Platz in je einer Zeile - kaum mehr als die Grundhoehe (am TV gemessen gut 6 Einheiten).
  const columnU = columnUnits(FALLBACK_AREA.w, 2);
  expect(columnU).toBe(82.5);
  expect(finaleRowUnits(shortRow(1), { columnU, unitU: unit, scale: NORMAL })).toBe(5.9);
  const heavy = finaleRowUnits(heavyRow(1), { columnU, unitU: unit, scale: NORMAL });
  expect(heavy).toBe(HEAVY_U);
});

test("fitFinaleColumns: acht schwere Zeilen - nur so viele, wie samt Kopf und „und N weitere“ über die Fußleiste passen", () => {
  const page = { rows: [...Array.from({ length: 8 }, (_, index) => heavyRow(index)), ...Array.from({ length: 8 }, (_, index) => heavyRow(index + 10, "down"))],
    more_up: 0, more_down: 2 };
  const area = { w: 173.4, h: 61 };
  const [up, down] = fitFinaleColumns(finaleColumns(page), { area, scale: NORMAL });
  expect([up.rows.length, up.more]).toEqual([6, 2]);
  expect([down.rows.length, down.more]).toEqual([6, 4]);
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
  expect([up.rows.length, up.more]).toEqual([5, 3]);
  const [tiny] = fitFinaleColumns(finaleColumns(page), { area: { w: 173.4, h: 5 }, scale: NORMAL });
  expect(tiny.rows.length).toBe(1);
});

test("#2561: das Abzeichen im Ziel-Chip zählt bei der Messung mit - breiter und höher, Name rückt zusammen, nie weniger Höhe", () => {
  const unit = rowUnits(8);
  const columnU = columnUnits(FALLBACK_AREA.w, 2);
  const plain = heavyRow(1);
  const badged = { ...plain, target_badge: { level: 1, nickname: null, champion: false } };
  expect(targetChipUnits(badged, { columnU, scale: NORMAL }).width)
    .toBeCloseTo(Math.min(targetChipUnits(plain, { columnU, scale: NORMAL }).natural + NORMAL.info * TARGET_BADGE_EM + FINALE_BOX.targetGap,
      targetChipUnits(plain, { columnU, scale: NORMAL }).max), 5);
  expect(finaleRowUnits(badged, { columnU, unitU: unit, scale: NORMAL })).toBeGreaterThanOrEqual(finaleRowUnits(plain, { columnU, unitU: unit, scale: NORMAL }));
  // Kurze Ziel-Liga: der Chip wird um das Abzeichen breiter und so hoch wie das Wappen - die Zeile bleibt bei ihrer Grundhöhe.
  const short = { ...shortRow(1), target_badge: { level: 3, nickname: null, champion: false } };
  const chip = targetChipUnits(short, { columnU, scale: NORMAL });
  expect(chip.width - targetChipUnits(shortRow(1), { columnU, scale: NORMAL }).width).toBeCloseTo(NORMAL.info * TARGET_BADGE_EM + FINALE_BOX.targetGap, 5);
  // Nie niedriger als der Text und nie niedriger als das Wappen samt Innenabstand.
  expect(chip.height).toBeGreaterThanOrEqual(targetChipUnits(shortRow(1), { columnU, scale: NORMAL }).height);
  expect(chip.height).toBeGreaterThanOrEqual(NORMAL.info * TARGET_BADGE_HEIGHT_EM + FINALE_BOX.targetPadY * 2 + FINALE_BOX.line * 2 - 1e-9);
  // Ist der Text einzeilig, bestimmt das Wappen die Höhe des Chips.
  const one = { ...short, target: "L3" };
  expect(targetChipUnits(one, { columnU, scale: NORMAL }).height)
    .toBeCloseTo(NORMAL.info * TARGET_BADGE_HEIGHT_EM + FINALE_BOX.targetPadY * 2 + FINALE_BOX.line * 2, 5);
  expect(finaleRowUnits(short, { columnU, unitU: unit, scale: NORMAL })).toBe(5.9);
});

test("#2561 K6: das Titel-Wappen bewegt sich nur über --tls-motion-on - auch die Skalierung steht bei „Bewegung aus“ still", () => {
  const css = readFileSync(path.join(process.cwd(), "src/components/tv/tv.css"), "utf8");
  const start = css.indexOf("@keyframes tv-finale-badge");
  expect(start).toBeGreaterThan(-1);
  const block = css.slice(start, css.indexOf("}", css.indexOf("}", start) + 1) + 1);
  expect(block).toContain("translateY(calc(var(--tv-u) * 0.6 * var(--tls-motion-on, 1)))");
  expect(block).toContain("scale(calc(1 - 0.06 * var(--tls-motion-on, 1)))");
  expect(block).not.toMatch(/scale\(0\.94\)/);
});
