// Saisonfinale am TV (#1641): Nach dem Sieger-Moment zeigt der Turnierbaum-TV einer abgeschlossenen Liga-Staffel je Liga N die Auf- und
// Absteiger. Der Server liefert `league_finale` (GET /bracket/display) nur, solange die Leitung den Schritt zeigt („Weiter“ im Reiter
// „Abschluss“ der Season) und nur für öffentliche Seasons. Hier wird nur zugeordnet: welche Seite dran ist, wer in welche Spalte gehört
// und wann jede Zeile kommt.

export const FINALE_SLIDE = "finale";
// Gestaffelt (Detail-Runde): erst der Titel, 150 ms später die Spaltenköpfe, dann je Zeile 90 ms später; die Ziel-Liga folgt, wenn
// die Zeile steht. Jede Verzögerung kommt von hier (CSS-Variablen an Abschnitt und Zeile) - im CSS steht keine feste Zeit.
export const FINALE_TIMING = Object.freeze({ head: 0.15, firstRow: 0.35, stagger: 0.09, target: 0.42, settle: 0.5 });
// Nr. 235: höchstens 8 Zeilen je Spalte am TV, der Rest als „und N weitere“ (der Server kürzt schon, hier zur Sicherheit noch einmal).
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

// Eine Ziel-Liga ab dieser Länge bricht in ihrer Spalte (gut ein Drittel der Zeile) eher um - die Zeile wird höher.
const TARGET_LONG = 18;
const HEAVY_SHARE = 0.5;

/** Wie viele Zeilen eine Spalte an Höhe braucht: Ein langer Name oder eine lange Ziel-Liga bricht um und zählt eine halbe Zeile mehr.
 *  So bleibt auch eine Spalte mit acht schweren Zeilen samt „und N weitere“ über der Fußleiste - die Zeilen werden niedriger, die
 *  Namen nie kleiner als die Untergrenze der TV-Namen. */
export function columnWeight(column) {
  const rows = column?.rows || [];
  const heavy = rows.filter((row) => nameFit(row.name) || targetText(row).length >= TARGET_LONG).length;
  return rows.length + heavy * HEAVY_SHARE;
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
