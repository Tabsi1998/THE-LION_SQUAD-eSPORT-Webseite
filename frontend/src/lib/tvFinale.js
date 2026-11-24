// Saisonfinale am TV (#1641): Nach dem Sieger-Moment zeigt der Turnierbaum-TV einer abgeschlossenen Liga-Staffel je Liga N die Auf- und
// Absteiger. Der Server liefert `league_finale` (GET /bracket/display) nur, solange die Leitung den Schritt zeigt („Weiter“ im Reiter
// „Abschluss“ der Season) und nur für öffentliche Seasons. Hier wird nur zugeordnet: welche Seite dran ist, wer in welche Spalte gehört
// und wann jede Zeile kommt.

import { TV_LINE, charsPerLine, wrapLines } from "@/lib/tvType";

export const FINALE_SLIDE = "finale";
// Gestaffelt (Detail-Runde): erst der Titel, 150 ms später die Spaltenköpfe, dann je Zeile 90 ms später; die Ziel-Liga folgt, wenn
// die Zeile steht. Jede Verzögerung kommt von hier (CSS-Variablen an Abschnitt und Zeile) - im CSS steht keine feste Zeit.
export const FINALE_TIMING = Object.freeze({ head: 0.15, firstRow: 0.35, stagger: 0.09, target: 0.42, settle: 0.5 });
// Nr. 235/238: höchstens 8 Zeilen je Spalte am TV - eine Obergrenze, keine Zusage. Es kommen nur so viele, wie samt Spaltenkopf und
// „und N weitere“ sicher über der Fußleiste stehen (`fitFinaleColumns`); der Rest zählt zu „und N weitere“.
export const COLUMN_ROWS = 8;
// Zeilenhöhe in TV-Einheiten (--tv-u): wenige Zeilen nicht über das ganze Bild, viele noch lesbar - darunter lieber kleiner schreiben.
// 44: Bei 16:9 tragen acht Zeilen (Nr. 235) samt Spaltenkopf und „und N weitere“ unter dem Titel und über der Fußleiste.
const ROOM_U = 44;
const ROW_MAX_U = 9;
const ROW_MIN_U = 4;

export const MOVE_WORDS = Object.freeze({ up: "Aufstieg", down: "Abstieg", out: "Scheidet aus" });

/** Die Seite, die gerade dran ist - `null`, wenn der Schritt aus ist oder nichts zu zeigen hat. */
export function finalePage(finale) {
  if (!finale || !Array.isArray(finale.pages)) return null;
  const step = Number(finale.step);
  if (!Number.isInteger(step) || step < 1 || step > finale.pages.length) return null;
  const page = finale.pages[step - 1];
  return page && Array.isArray(page.rows) && page.rows.length ? { ...page, step, count: finale.pages.length } : null;
}

/** Zwei Spalten: links wer aufsteigt, rechts wer absteigt oder ausscheidet. Gibt es nur eine Seite, steht sie allein in der Mitte.
 *  Je Spalte höchstens `COLUMN_ROWS` Zeilen; `more` zählt, was der Server (`more_up`, `more_down`) und diese Grenze weglassen. */
export function finaleColumns(page) {
  const rows = page?.rows || [];
  const up = rows.filter((row) => row.move === "up");
  const down = rows.filter((row) => row.move === "down" || row.move === "out");
  const column = (key, title, list, cut) => ({ key, title, rows: list.slice(0, COLUMN_ROWS),
    more: Math.max(0, list.length - COLUMN_ROWS) + Math.max(0, Number(cut) || 0) });
  return [
    up.length ? column("up", MOVE_WORDS.up, up, page?.more_up) : null,
    down.length ? column("down", down.every((row) => row.move === "out") ? MOVE_WORDS.out : MOVE_WORDS.down, down, page?.more_down) : null,
  ].filter(Boolean);
}

/** Der Rest einer Spalte in Worten - „und 4 weitere“. */
export function moreText(count) {
  return count === 1 ? "und 1 weiteres Team" : `und ${count} weitere`;
}

/** Wann eine Zeile kommt (Sekunden): über beide Spalten durchgezählt, damit nie zwei Zeilen zugleich landen. */
export function rowDelay(index) {
  return +(FINALE_TIMING.firstRow + index * FINALE_TIMING.stagger).toFixed(2);
}

/** Höhe je Zeile in TV-Einheiten - aus der längsten Spalte. */
export function rowUnits(rowsInLongestColumn) {
  const rows = Math.max(1, Number(rowsInLongestColumn) || 1);
  return +Math.min(ROW_MAX_U, Math.max(ROW_MIN_U, ROOM_U / rows)).toFixed(2);
}

/** Lange Namen eine bzw. zwei Stufen kleiner - umbrechen dürfen sie, abgeschnitten wird nie. */
export function nameFit(name) {
  const length = String(name || "").length;
  return length > 34 ? "tiny" : length > 22 ? "small" : undefined;
}

/** Die Zeile unter dem Namen: Platz und - bei mehreren Staffeln je Liga N - die Staffel. */
export function rowMeta(row) {
  return [row?.rank ? `Platz ${row.rank}` : null, row?.staffel ? `Staffel ${row.staffel}` : null].filter(Boolean).join(" · ");
}

/** Wohin es geht: „Liga 1“ mit Pfeil, beim Ausscheiden „scheidet aus“. */
export function targetText(row) {
  if (row?.move === "out") return "scheidet aus";
  return row?.target || "";
}

/** Was ein Screenreader zur Zeile hört - das Symbol selbst ist Zierde. */
export function rowLabel(row) {
  if (row?.move === "out") return `${row.name} scheidet aus`;
  const word = row?.move === "up" ? "steigt auf" : "steigt ab";
  return row?.target ? `${row.name} ${word} in ${row.target}` : `${row.name} ${word}`;
}

// ---------------------------------------------------------------- Was sicher über die Fußleiste passt (Nr. 238)
// Dieselben Maße wie tv.css „Saisonfinale“, in TV-Einheiten (U = Grundhöhe einer Zeile, --tv-finale-unit). Die Zeichenbreite aus
// lib/tvType.js ist eher großzügig - geschätzt wird lieber eine Zeile zu viel Umbruch als eine zu wenig.
export const FINALE_BOX = Object.freeze({
  colGap: 4, colOne: 110, stack: 1.2, edge: 0.6, padX: 1.8, padY: 0.12, gap: 1.6, sign: 0.62, line: 0.1,
  targetMax: 0.42, targetMaxU: 38, targetPadX: 1.2, targetPadY: 0.25, targetGap: 0.6, targetLine: 1.05, nameLine: 1.1, rowGap: 0.16,
  safety: 0.5,
});
// Namen stehen in der fetten Überschriftenschrift: gut 0,7 em je Zeichen statt der 0,5 aus lib/tvType.js (am TV gemessen: ein Name
// mit 54 Zeichen bricht in einer Spalte bei 1920 px dreizeilig um). Lieber eine Zeile zu viel geschätzt als eine verdeckt.
const NAME_WIDTH = 1.4;
// Ohne gemessene Fläche (erster Lauf, Tests): die Fläche der Spalten in einem 16:9-Bild - am TV gemessen gut 61 Einheiten hoch.
export const FALLBACK_AREA = Object.freeze({ w: 169, h: 61 });

/** Breite einer Spalte in Einheiten - zwei nebeneinander, eine allein höchstens 110 breit (wie tv.css). */
export function columnUnits(areaWidth, columns) {
  const width = Number(areaWidth) || FALLBACK_AREA.w;
  return columns > 1 ? (width - FINALE_BOX.colGap) / 2 : Math.min(FINALE_BOX.colOne, width);
}

/** Die geschätzte Höhe einer Zeile in Einheiten: Name (umbrochen) mit Platz/Staffel daneben die Ziel-Liga (umbrochen) - mindestens U. */
export function finaleRowUnits(row, { columnU, unitU, scale }) {
  const box = FINALE_BOX;
  const inner = columnU - box.edge - box.padX * 2 - box.line * 2;
  const target = targetText(row);
  let targetU = 0;
  let targetHeight = 0;
  if (target) {
    const arrow = row?.move === "out" ? 0 : scale.info + box.targetGap;
    const natural = [...target].length * scale.info * 0.5 + arrow + box.targetPadX * 2 + box.line * 2;
    targetU = Math.min(natural, inner * box.targetMax, box.targetMaxU);
    const lines = wrapLines(target, charsPerLine(Math.max(4, targetU - arrow - box.targetPadX * 2 - box.line * 2), scale.info));
    targetHeight = lines * scale.info * box.targetLine + box.targetPadY * 2 + box.line * 2;
  }
  const nameU = Math.max(8, inner - unitU * box.sign - box.gap * (target ? 2 : 1) - targetU);
  const font = nameFit(row?.name) ? scale.nameMin : scale.name;
  const nameLines = wrapLines(row?.name || "Team", charsPerLine(nameU, font * NAME_WIDTH));
  const meta = rowMeta(row) ? scale.meta * TV_LINE.meta : 0;
  const content = Math.max(nameLines * font * box.nameLine + meta, targetHeight, unitU * box.sign);
  return +Math.max(unitU, content + unitU * box.padY * 2 + box.line * 2).toFixed(2);
}

/**
 * Je Spalte nur so viele Zeilen, wie samt Spaltenkopf und „und N weitere“ in die Fläche passen (`area` in Einheiten, gemessen an
 * .tv-finale__cols) - höchstens die, die schon da sind (8). `trim` ({up, down}): so viele Zeilen weniger, weil die Spalte am TV trotz
 * Rechnung überlief (andere Schrift). Nie weniger als eine Zeile. Gibt die Spalten mit `rows`, `more`, `unitU` und `heightU` zurück.
 */
export function fitFinaleColumns(columns, { area, scale, trim = {} }) {
  const box = FINALE_BOX;
  const size = area?.w && area?.h ? area : FALLBACK_AREA;
  const columnU = columnUnits(size.w, columns.length);
  const unitU = rowUnits(Math.max(1, ...columns.map((column) => column.rows.length)));
  const headU = scale.head * TV_LINE.head + box.stack;
  const moreU = scale.info * TV_LINE.info + box.stack;
  const gapU = unitU * box.rowGap;
  const room = size.h - box.safety - headU;
  return columns.map((column) => {
    const heights = column.rows.map((row) => finaleRowUnits(row, { columnU, unitU, scale }));
    const total = (count) => heights.slice(0, count).reduce((sum, height) => sum + height, 0) + gapU * Math.max(0, count - 1);
    let count = column.rows.length;
    // Ein „und N weitere“ braucht seinen Platz, sobald etwas fehlt - vom Server oder von hier.
    while (count > 1 && total(count) + (column.more || count < column.rows.length ? moreU : 0) > room) count -= 1;
    count = Math.max(1, count - Math.max(0, Number(trim[column.key]) || 0));
    const more = (column.more || 0) + column.rows.length - count;
    return { ...column, rows: column.rows.slice(0, count), more, unitU,
      heightU: +(headU + total(count) + (more ? moreU : 0)).toFixed(2) };
  });
}
