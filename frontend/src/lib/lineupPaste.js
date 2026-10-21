// Aufstellung bzw. Kader einfügen (#1931): die Liste von der Match-Seite des Veranstalters, etwa zwei Spalten
// „Seasonteam-Mitglieder | Warorga“. Wer ein Häkchen hat, hat gespielt (`played: true`); „-“ oder „nein“ heißt nicht
// gespielt (`false`), leer heißt unbekannt (`null`) - beim Kopieren aus dem Browser wird das Häkchen oft zum Bild und
// fehlt dann. Erkannt werden „✓“, „✔“, „☑“, „✅“, „x“ und „ja“; Tab, „|“ und „;“ trennen Spalten, ohne Trenner zählt
// ein Häkchen am Ende der Zeile. `marked` sagt, ob überhaupt ein Häkchen erkannt wurde. Zeichenweise, ohne regulären
// Ausdruck über die Eingabe.
import { cleanText, normalizeText } from "@/lib/resultPaste";

const MAX_NAME = 120;
const MAX_ROWS = 100;
const YES = new Set(["✓", "✔", "✔️", "☑", "☑️", "✅", "x", "ja", "j", "yes", "y", "gespielt"]);
const NO = new Set(["-", "–", "—", "nein", "n", "no", "✗", "✘", "❌"]);
const NAME_HEADERS = ["seasonteam-mitglieder", "seasonteam mitglieder", "mitglieder", "mitglied", "spieler", "name",
  "member", "members", "player", "players", "kader"];
const MARK_HEADERS = ["warorga", "gespielt", "aufstellung", "einsatz", "played", "lineup", "dabei"];

function mark(cell) {
  const word = cleanText(cell).toLowerCase();
  if (YES.has(word)) return true;
  if (NO.has(word)) return false;
  return null;
}

function isMark(cell) {
  return mark(cell) !== null;
}

function headerOf(cells) {
  const words = cells.map((cell) => cleanText(cell).toLowerCase());
  const name = words.findIndex((word) => NAME_HEADERS.includes(word));
  if (name < 0) return null;
  return { name, mark: words.findIndex((word) => MARK_HEADERS.includes(word)) };
}

function pickSeparator(lines) {
  for (const char of ["\t", "|", ";"]) if (lines.some((line) => line.text.includes(char))) return char;
  return null;
}

/** Liefert `{rows: [{line, name, played}], marked, errors: [{line, text, message}]}` - jeder Name einmal. */
export function parseLineupPaste(text) {
  const errors = [];
  const lines = [];
  normalizeText(text).split("\n").forEach((raw, index) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (cleanText(line)) lines.push({ number: index + 1, text: line });
  });
  if (lines.length > MAX_ROWS) {
    errors.push({ line: null, text: "", message: `Höchstens ${MAX_ROWS} Namen auf einmal.` });
    lines.length = MAX_ROWS;
  }
  const separator = pickSeparator(lines);
  const rows = [];
  const seen = new Set();
  let header = null;
  lines.forEach((line, position) => {
    const cells = separator ? line.text.split(separator).map(cleanText) : [cleanText(line.text)];
    if (position === 0 && separator) {
      header = headerOf(cells);
      if (header) return;
    }
    if (position === 0 && !separator && headerOf(cells)) return;
    let name = "";
    let played = null;
    if (header && cells[header.name] && !isMark(cells[header.name])) {
      name = cells[header.name];
      if (header.mark >= 0) played = mark(cells[header.mark] || "");
      else played = cells.map(mark).find((value) => value !== null) ?? null;
    } else {
      for (const cell of cells) {
        if (!cell) continue;
        if (isMark(cell)) {
          if (played === null) played = mark(cell);
        } else if (!name) {
          // Ein Häkchen als letztes Wort gehört nicht zum Namen.
          const words = cell.split(" ");
          if (words.length > 1 && isMark(words[words.length - 1])) {
            const last = mark(words.pop());
            if (played === null) played = last;
          }
          name = words.join(" ");
        }
      }
    }
    const shown = cleanText(line.text).slice(0, 80);
    if (!name) {
      errors.push({ line: line.number, text: shown, message: "Kein Name erkannt." });
      return;
    }
    const key = name.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    rows.push({ line: line.number, name: name.slice(0, MAX_NAME), played });
  });
  return { rows, marked: rows.some((row) => row.played === true), errors };
}
