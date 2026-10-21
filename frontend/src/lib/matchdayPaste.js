// Spieltag einfügen (#1931): die Begegnungsliste des Veranstalters - je Zeile Termin, Heim, Auswärts und Ergebnis.
// Welches Spiel das eigene ist, entscheidet danach `lib/teamLeagueEntry.js` über die eigenen Teams der Saison.
//
// Erkannt werden:
// - Tabellen mit Tab (aus Excel oder einer Website), „|“ oder „;“ - mit Kopfzeile („Termin | Heim | Auswärts |
//   Ergebnis“, auch Datum und Uhrzeit getrennt, auch englisch) oder ohne: Datum und Uhrzeit vor den Teams, der erste
//   Text ist Heim, der zweite Auswärts, „2:1“ nach dem ersten Team das Ergebnis.
// - Zeilen ohne Trenner: „13.05. 20:30 Heim 2:1 Gast“, „Heim vs Gast 2:1“, „Heim – Gast“.
// - Ohne Ergebnis („-:-“ oder leer) ist das Spiel noch offen: `home_score`/`away_score` sind dann `null`.
// Ohne Jahr gilt `year` (das Jahr des Termins). Nur Zeichen und kurze Wörter werden geprüft, nie ein regulärer Ausdruck
// über die ganze Eingabe - auch sehr lange Texte bleiben schnell. Was sich nicht lesen lässt, kommt mit Zeilennummer
// zurück.
import { cleanText, normalizeText, parseNumber } from "@/lib/resultPaste";

export const MAX_MATCHDAY_ROWS = 100;
const MAX_TEAM = 120;
const MISSING_TEAM = "Heim- oder Auswärtsteam fehlt.";

const HEADERS = {
  day: ["datum", "date", "tag", "spieltag datum"],
  time: ["zeit", "uhrzeit", "time", "anstoß", "anstoss", "beginn", "start"],
  when: ["termin", "spieltermin", "wann", "datum/zeit", "datum / zeit", "date/time"],
  home: ["heim", "home", "heimteam", "team 1", "team1", "gastgeber", "heimmannschaft"],
  away: ["auswärts", "auswaerts", "gast", "away", "auswärtsteam", "gastteam", "team 2", "team2", "gastmannschaft"],
  score: ["ergebnis", "score", "resultat", "result", "endstand", "stand"],
};
const WEEKDAYS = new Set(["mo", "di", "mi", "do", "fr", "sa", "so", "montag", "dienstag", "mittwoch", "donnerstag",
  "freitag", "samstag", "sonntag", "mon", "tue", "wed", "thu", "fri", "sat", "sun"]);
const TEAM_SEPARATORS = new Set(["vs", "vs.", "-", "–", "—", "gegen", "v", ":"]);
const OPEN_SCORES = new Set(["-:-", "–:–", "—:—", "-", "–", "vs", "vs.", "?:?"]);

function isDigits(text) {
  if (!text) return false;
  for (const char of text) if (char < "0" || char > "9") return false;
  return true;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function realDay(year, month, day) {
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

/** „13.05.“, „13.05.2026“, „13.05.26“ oder „2026-05-13“ → `{day, error}` (ohne Jahr und ohne `year`: leer). */
function readDate(token, year) {
  const text = token.endsWith(",") ? token.slice(0, -1) : token;
  let parts;
  if (text.length === 10 && text[4] === "-" && text[7] === "-") {
    parts = [text.slice(8, 10), text.slice(5, 7), text.slice(0, 4)];
  } else {
    const pieces = text.split(".");
    if (pieces.length < 3 || pieces.length > 3) return null;
    parts = pieces;
  }
  const [dayText, monthText, yearText] = parts;
  if (!isDigits(dayText) || !isDigits(monthText) || dayText.length > 2 || monthText.length > 2) return null;
  if (yearText && (!isDigits(yearText) || ![2, 4].includes(yearText.length))) return null;
  const day = Number(dayText);
  const month = Number(monthText);
  const full = yearText ? Number(yearText.length === 2 ? `20${yearText}` : yearText) : Number(year) || null;
  // Ohne Jahr prüft ein Schaltjahr, ob es den Tag überhaupt gibt - der Tag selbst bleibt dann offen.
  if (!realDay(full || 2024, month, day)) return { day: "", error: `Datum ${pad(day)}.${pad(month)}.${yearText || ""} gibt es nicht.` };
  return { day: full ? `${full}-${pad(month)}-${pad(day)}` : "", error: null };
}

/** „20:30“ (auch „20:30 Uhr“) → „20:30“, sonst `null`. */
function readTime(token) {
  const at = token.indexOf(":");
  if (at < 1) return null;
  const hours = token.slice(0, at);
  const minutes = token.slice(at + 1);
  if (!isDigits(hours) || !isDigits(minutes) || hours.length > 2 || minutes.length !== 2) return null;
  if (Number(hours) > 23 || Number(minutes) > 59) return null;
  return `${pad(hours)}:${minutes}`;
}

/** „2:1“, „2 : 1“ → `[2, 1]`; „-:-“ → `"open"`; sonst `null`. */
function readScore(text) {
  const value = cleanText(text);
  if (OPEN_SCORES.has(value.toLowerCase())) return "open";
  const at = value.indexOf(":");
  if (at < 1) return null;
  const left = parseNumber(value.slice(0, at));
  const right = parseNumber(value.slice(at + 1));
  return left === null || right === null || left < 0 || right < 0 ? null : [left, right];
}

function isWeekday(token) {
  let word = token.toLowerCase();
  while (word.endsWith(".") || word.endsWith(",")) word = word.slice(0, -1);
  return WEEKDAYS.has(word);
}

/** Termin aus Wörtern: Datum, Uhrzeit, Wochentag und „Uhr“ - liefert, was gefunden wurde, und ob alles passte. */
function readWhen(words, year) {
  const out = { day: "", time: "", error: null, used: true };
  for (const word of words) {
    if (!word || isWeekday(word) || word.toLowerCase() === "uhr") continue;
    const date = readDate(word, year);
    if (date) {
      out.day = date.day;
      out.error = out.error || date.error;
      continue;
    }
    const time = readTime(word);
    if (time) {
      out.time = time;
      continue;
    }
    out.used = false;
  }
  return out;
}

function isWhenWord(word, year) {
  return Boolean(word) && (isWeekday(word) || word.toLowerCase() === "uhr" || readDate(word, year) || readTime(word));
}

function headerKey(cell) {
  const word = cleanText(cell).toLowerCase();
  for (const [key, words] of Object.entries(HEADERS)) if (words.includes(word)) return key;
  return null;
}

function splitCells(text, separator) {
  const cells = text.split(separator).map(cleanText);
  if (separator === "|") {
    if (cells.length && !cells[0]) cells.shift();
    if (cells.length && !cells[cells.length - 1]) cells.pop();
  }
  return cells;
}

function emptyRow() {
  return { day: "", time: "", home: "", away: "", home_score: null, away_score: null };
}

function setScore(row, score) {
  if (Array.isArray(score)) [row.home_score, row.away_score] = score;
}

/** Mehr Zellen als die Kopfzeile (Logo-Spalten, die im Kopf mit dem Team zusammengefasst sind): leere Zellen fallen
 * von links weg, bis es passt. */
function alignCells(cells, length) {
  const out = [...cells];
  while (out.length > length) {
    const empty = out.findIndex((cell) => !cell);
    if (empty < 0) break;
    out.splice(empty, 1);
  }
  return out;
}

function fromHeader(raw, keys, year) {
  const cells = alignCells(raw, keys.length);
  const row = emptyRow();
  let error = null;
  keys.forEach((key, index) => {
    const cell = cells[index] || "";
    if (!key || !cell) return;
    if (key === "home") row.home = cell;
    else if (key === "away") row.away = cell;
    else if (key === "score") setScore(row, readScore(cell));
    else {
      const when = readWhen(cell.split(" "), year);
      if (when.day) row.day = when.day;
      if (when.time) row.time = when.time;
      error = error || when.error;
    }
  });
  return { row, error };
}

function fromCells(cells, year) {
  const row = emptyRow();
  let error = null;
  for (const cell of cells) {
    if (!cell) continue;
    if (!row.home && isWhenWord(cell.split(" ")[0], year)) {
      const when = readWhen(cell.split(" "), year);
      if (when.used) {
        if (when.day) row.day = when.day;
        if (when.time) row.time = when.time;
        error = error || when.error;
        continue;
      }
    }
    const score = row.home ? readScore(cell) : null;
    if (score) {
      setScore(row, score);
      continue;
    }
    if (!row.home) row.home = cell;
    else if (!row.away) row.away = cell;
  }
  return { row, error };
}

function scoreAt(words, index) {
  // „2:1“ als ein Wort oder „2 : 1“ als drei.
  const single = readScore(words[index]);
  if (single && words[index] !== "-" && words[index] !== "–" && words[index].toLowerCase() !== "vs" && words[index].toLowerCase() !== "vs.") {
    return { score: single, width: 1 };
  }
  if (words[index + 1] === ":" && parseNumber(words[index]) !== null && parseNumber(words[index + 2] || "") !== null) {
    return { score: [parseNumber(words[index]), parseNumber(words[index + 2])], width: 3 };
  }
  return null;
}

function fromLine(text, year) {
  const words = cleanText(text).split(" ");
  let start = 0;
  while (start < words.length && isWhenWord(words[start], year)) start += 1;
  const when = readWhen(words.slice(0, start), year);
  const row = { ...emptyRow(), day: when.day, time: when.time };
  const rest = words.slice(start);
  let found = null;
  for (let index = 1; index < rest.length; index += 1) {
    found = scoreAt(rest, index);
    if (found) {
      found.index = index;
      break;
    }
  }
  let teams = rest;
  if (found) {
    setScore(row, found.score);
    const after = rest.slice(found.index + found.width);
    if (after.length) {
      row.home = rest.slice(0, found.index).join(" ");
      row.away = after.join(" ");
      return { row, error: when.error };
    }
    teams = rest.slice(0, found.index);
  }
  const split = teams.findIndex((word, index) => index > 0 && index < teams.length - 1 && TEAM_SEPARATORS.has(word.toLowerCase()));
  if (split > 0) {
    row.home = teams.slice(0, split).join(" ");
    row.away = teams.slice(split + 1).join(" ");
  } else {
    row.home = teams.join(" ");
  }
  return { row, error: when.error };
}

function pickSeparator(lines) {
  for (const char of ["\t", "|", ";"]) if (lines.some((line) => line.text.includes(char))) return char;
  return null;
}

const MATCHDAY_HEADING = /(\d{1,3})\. ?spieltag|spieltag ?(\d{1,3})(?!\d)/;
const DASHES = new Set([":", "-", "–", "—"]);

function trimDashes(word) {
  let start = 0;
  let end = word.length;
  while (start < end && DASHES.has(word[start])) start += 1;
  while (end > start && DASHES.has(word[end - 1])) end -= 1;
  return word.slice(start, end);
}

/**
 * Zwischenüberschrift einer Liste mit mehreren Spieltagen: „Begegnungen des 2. Spieltags“ → `{number: 2}`,
 * „Zeitraum: 17.06.2026 - 21.06.2026“ → `{from, to}`; sonst `null`. Nur eine Zeile mit genau einem Text zählt.
 */
function readHeading(cells, year) {
  const filled = cells.filter(Boolean);
  if (filled.length !== 1) return null;
  const line = filled[0].toLowerCase();
  if (line.startsWith("zeitraum")) {
    const days = line.slice("zeitraum".length).split(" ").map((word) => readDate(trimDashes(word), year)).filter((item) => item && item.day);
    if (days.length) return { from: days[0].day, to: days[days.length - 1].day };
    return { from: "", to: "" };
  }
  const found = MATCHDAY_HEADING.exec(line.length > 200 ? line.slice(0, 200) : line);
  return found ? { number: Number(found[1] || found[2]) } : null;
}

const IGNORED_CELLS = new Set(["zum matchup", "matchup", "zum match", "details", "link", "spielbericht"]);

/**
 * Begegnungsliste aus der Zwischenablage. Liefert `{rows: [{line, matchday, day, time, home, away, home_score,
 * away_score}], matchdays: [{number, from, to, rows}], errors: [{line, text, message}]}`. `day` ist „JJJJ-MM-TT“ (leer
 * ohne Datum oder Jahr), `time` „HH:MM“ oder leer. Mehrere Spieltage hintereinander trennen Zwischenüberschriften
 * („Begegnungen des 2. Spieltags“, „Zeitraum: …“) - ohne sie ist alles ein Spieltag ohne Nummer.
 */
export function parseMatchdayPaste(text, { year = null } = {}) {
  const errors = [];
  const lines = [];
  normalizeText(text).split("\n").forEach((raw, index) => {
    const line = raw.endsWith("\r") ? raw.slice(0, -1) : raw;
    if (cleanText(line)) lines.push({ number: index + 1, text: line });
  });
  if (lines.length > MAX_MATCHDAY_ROWS) {
    errors.push({ line: null, text: "", message: `Höchstens ${MAX_MATCHDAY_ROWS} Spiele auf einmal.` });
    lines.length = MAX_MATCHDAY_ROWS;
  }
  const separator = pickSeparator(lines);
  let keys = null;
  const rows = [];
  const matchdays = [];
  let block = null;
  const startBlock = () => {
    block = { number: null, from: "", to: "", rows: [] };
    matchdays.push(block);
  };
  lines.forEach((line) => {
    const cells = separator ? splitCells(line.text, separator) : [cleanText(line.text)];
    const heading = readHeading(cells, year);
    if (heading) {
      // Neuer Spieltag: bei einer Nummer, wenn der laufende schon eine hat oder Spiele; ein Zeitraum, wenn schon Spiele da sind.
      if (!block || block.rows.length || ("number" in heading && block.number !== null)) startBlock();
      Object.assign(block, heading);
      return;
    }
    if (separator) {
      const header = cells.map(headerKey);
      if (header.includes("home") && header.includes("away")) {
        keys = header;
        return;
      }
    }
    let parsed;
    if (separator) {
      const data = cells.map((cell) => (IGNORED_CELLS.has(cell.toLowerCase()) ? "" : cell));
      parsed = keys ? fromHeader(data, keys, year) : fromCells(data, year);
    } else {
      parsed = fromLine(line.text, year);
    }
    const shown = cleanText(line.text).slice(0, 80);
    if (parsed.error) {
      errors.push({ line: line.number, text: shown, message: parsed.error });
      return;
    }
    const { row } = parsed;
    if (!row.home || !row.away || parseNumber(row.home) !== null || parseNumber(row.away) !== null) {
      errors.push({ line: line.number, text: shown, message: MISSING_TEAM });
      return;
    }
    if (!block) startBlock();
    const entry = { line: line.number, matchday: block.number, ...row, home: row.home.slice(0, MAX_TEAM), away: row.away.slice(0, MAX_TEAM) };
    rows.push(entry);
    block.rows.push(entry);
  });
  return { rows, matchdays: matchdays.filter((day) => day.rows.length), errors };
}
