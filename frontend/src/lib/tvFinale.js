// Saisonfinale am TV (#1641): Nach dem Sieger-Moment zeigt der Turnierbaum-TV einer abgeschlossenen Liga-Staffel je Liga N die Auf- und
// Absteiger. Der Server liefert `league_finale` (GET /bracket/display) nur, solange die Leitung den Schritt zeigt („Weiter“ im Reiter
// „Abschluss“ der Season) und nur für öffentliche Seasons. Hier wird nur zugeordnet: welche Seite dran ist, wer in welche Spalte gehört
// und wann jede Zeile kommt.

export const FINALE_SLIDE = "finale";
// Gestaffelt (Detail-Runde): erst Titel und Spaltenköpfe, dann je Zeile 90 ms später; die Ziel-Liga folgt, wenn die Zeile steht.
export const FINALE_TIMING = Object.freeze({ firstRow: 0.35, stagger: 0.09, target: 0.42, settle: 0.5 });
// Zeilenhöhe in TV-Einheiten (--tv-u): wenige Zeilen nicht über das ganze Bild, viele noch lesbar - darunter lieber kleiner schreiben.
const ROOM_U = 52;
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

/** Zwei Spalten: links wer aufsteigt, rechts wer absteigt oder ausscheidet. Gibt es nur eine Seite, steht sie allein in der Mitte. */
export function finaleColumns(page) {
  const rows = page?.rows || [];
  const up = rows.filter((row) => row.move === "up");
  const down = rows.filter((row) => row.move === "down" || row.move === "out");
  return [
    up.length ? { key: "up", title: MOVE_WORDS.up, rows: up } : null,
    down.length ? { key: "down", title: down.every((row) => row.move === "out") ? MOVE_WORDS.out : MOVE_WORDS.down, rows: down } : null,
  ].filter(Boolean);
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
