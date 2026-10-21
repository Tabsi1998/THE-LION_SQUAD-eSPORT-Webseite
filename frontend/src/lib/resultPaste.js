// Ergebnisliste einfügen (#1744): der EINZIGE Text-Parser für Ergebnisse externer Serien. Der Server nimmt nur
// strukturierte Zeilen; hier wird aus der Zwischenablage eine Liste mit Platz, Name, Team, Punkten, Startnummer und
// Marken – danach prüft und rechnet die Vorschau des Servers.
//
// Erkannt werden:
// - Zeilen wie „1. Name  25“ (Punkte mit zwei Leerzeichen abgesetzt), „1. Name 25 Pkt“, „1) Name“, „Name“ (nur Namen in
//   Reihenfolge), „3 Name DNF“. Eine Zahl, die nur mit einem Leerzeichen am Namen hängt, bleibt beim Namen (`points_hint`).
// - Tabellen mit Tab (aus Excel oder einer Website kopiert), „|“ oder „;“ als Trenner – mit oder ohne Kopfzeile
//   („Platz | Fahrer | Team | Punkte“). Ohne Kopfzeile: erste Zahl Platz, erster Text Name, zweiter Text Team, letzte
//   Zahl Punkte, eine Zahl vor dem Namen Startnummer; „Name;Platz“ geht auch.
// - Rennergebnis (#1927): Spalten Startnummer, Startplatz („Start“, „Grid“), Zeit, Abstand („+5.204“, „+1 Runde“) und
//   beste Runde – die schnellste daraus wird die schnellste Runde des Rennens. Ohne Kopfzeile zählt eine Zelle mit „:“
//   als Zeit, eine mit „+“ als Abstand. Zeilen „Schnellste Runde: Name 1:31.456“ und „Fahrer des Tages: Name“ gehören
//   zum Rennen, nicht in die Liste. Die Felder heißen wie bei der Texterkennung (#1756): start_number, grid, time, gap.
// - Turniertag (#1961): mit Kopfzeile die Spalten der Runden („R 1“ … „R 5“, „R1“, „Runde 1“) als Rundenpunkte, „GES P“
//   als Tagessumme und je Sonderbonus der Saison eine Spalte mit seinem Namen („Bingo“: x, ja, ✓ oder eine Zahl > 0).
// Ganz ohne reguläre Ausdrücke auf der Eingabe (nur Zeichen für Zeichen), damit auch sehr lange Texte schnell bleiben.
// Was sich nicht lesen lässt, kommt als Fehler mit Zeilennummer zurück – nichts wird still verschluckt.

export const MAX_PASTE_ROWS = 500;
export const MAX_PASTE_CHARS = 200_000;
const MAX_NAME = 120;
const NO_NAME = "Kein Name erkannt.";
const NO_TEAM = "Kein Team erkannt.";

const SEPARATORS = [["\t", "tab"], ["|", "pipe"], [";", "semicolon"]];

// „OUT“ schreibt etwa die PRL für einen Ausfall mit 0 Punkten (#1927), auch als „DNF/OUT“.
const MARK_WORDS = {
  dnf: "dnf", ret: "dnf", ausfall: "dnf", aufgegeben: "dnf", out: "dnf", "dnf/out": "dnf", "out/dnf": "dnf",
  dns: "dns", "nicht gestartet": "dns",
  dsq: "dsq", dq: "dsq", disq: "dsq", disqualifiziert: "dsq",
  fl: "fastest_lap", "schnellste runde": "fastest_lap", "fastest lap": "fastest_lap",
  pole: "pole",
};

const POINT_UNITS = new Set(["pkt", "pkt.", "punkte", "pts", "pts.", "points", "p", "p."]);

const RESULT_HEADERS = {
  place: ["platz", "pl", "pos", "position", "rang", "rank", "#"],
  name: ["name", "fahrer", "spieler", "driver", "player", "teilnehmer", "pilot", "gamertag"],
  team: ["team", "rennstall", "clan", "constructor", "mannschaft"],
  points: ["punkte", "pkt", "pts", "points"],
  start_number: ["nr", "startnummer", "no", "nummer", "number", "startnr"],
  marks: ["status", "info", "bemerkung"],
  grid: ["start", "startplatz", "startpos", "grid", "quali", "qualifying"],
  time: ["zeit", "time", "rennzeit", "gesamtzeit", "race time"],
  gap: ["abstand", "gap", "rückstand", "interval", "intervall", "diff", "differenz"],
  best_lap: ["beste runde", "best lap", "bestlap", "schnellste runde", "fastest lap", "rundenbestzeit", "beste"],
  // Tagessumme eines Turniertags (#1961).
  day_points: ["ges p", "ges. p", "gesp", "ges", "tagessumme", "tagespunkte"],
};

// Spalten der Runden eines Turniertags (#1961): Wort und Nummer, mit oder ohne Leerzeichen („R 1“, „R1“, „Runde 3“).
const ROUND_WORDS = ["runde", "round", "rd", "r"];
const MAX_ROUNDS = 20;
const NO_BONUS = new Set(["0", "-", "–", "nein", "no", "n"]);

function roundHeader(word) {
  for (const prefix of ROUND_WORDS) {
    if (!word.startsWith(prefix)) continue;
    const rest = word.slice(prefix.length).trimStart();
    if (!rest || rest.length > 2) continue;
    let digits = true;
    for (const char of rest) if (!isDigit(char)) digits = false;
    const number = digits ? Number(rest) : 0;
    if (number >= 1 && number <= MAX_ROUNDS) return `round:${number}`;
  }
  return null;
}

/** Ist ein Sonderbonus in der Zelle abgehakt? Leer, „0“, „-“ und „nein“ heißen nein. */
function bonusTicked(cell) {
  const value = cleanText(cell).toLowerCase();
  if (!value || NO_BONUS.has(value)) return false;
  const number = parseNumber(value);
  return number === null || number > 0;
}

// Zeilen, die zum Rennen gehören statt zu einem Fahrer (#1927): Präfix, dann „:“.
const RACE_LINES = [
  ["schnellste runde", "fastest_lap"], ["fastest lap", "fastest_lap"],
  ["fahrer des tages", "driver_of_the_day"], ["driver of the day", "driver_of_the_day"], ["dotd", "driver_of_the_day"],
];

const TABLE_HEADERS = {
  rank: ["platz", "pl", "pos", "position", "rang", "rank", "#"],
  team: ["team", "mannschaft", "verein", "name", "clan"],
  played: ["sp", "spiele", "gp", "played", "mp"],
  won: ["s", "siege", "w", "won", "wins"],
  drawn: ["u", "unentschieden", "d", "draws", "drawn", "remis"],
  lost: ["n", "niederlagen", "l", "losses", "lost"],
  score: ["tore", "maps", "score", "ergebnis", "runden"],
  score_diff: ["diff", "differenz", "+/-", "td", "md"],
  points: ["pkt", "punkte", "pts", "points"],
};

// Jede Art Leerraum zählt gleich: Leerzeichen, Tab, geschütztes und schmales geschütztes Leerzeichen (U+00A0, U+202F),
// Ziffern- und Viertelgeviert-Leerzeichen, Zeilentrenner. Unsichtbare Zeichen ohne Breite (U+200B, U+2060, BOM) fallen
// weg. Der Ausdruck prüft genau ein Zeichen und ist damit linear.
const SPACE = /\s/u;
const INVISIBLE = new Set(["\u200b", "\u2060", "\ufeff"]);

function isSpace(char) {
  return SPACE.test(char);
}

/** Text vor dem Erkennen: Unicode in NFC (ein „é“ ist dann immer dasselbe Zeichen). */
export function normalizeText(value) {
  const text = String(value ?? "");
  return typeof text.normalize === "function" ? text.normalize("NFC") : text;
}

/** Leerraum zusammenfassen – ohne regulären Ausdruck über die ganze Eingabe. */
export function cleanText(value) {
  const text = normalizeText(value);
  let out = "";
  let pending = false;
  for (const char of text) {
    if (INVISIBLE.has(char)) continue;
    if (isSpace(char)) {
      pending = out.length > 0;
      continue;
    }
    if (pending) out += " ";
    pending = false;
    out += char;
  }
  return out;
}

function isDigit(char) {
  return char >= "0" && char <= "9";
}

/** Zahl wie „25“, „12,5“, „-3“, „+2“ – sonst `null`. */
export function parseNumber(value) {
  const text = cleanText(value);
  if (!text) return null;
  let index = 0;
  if (text[0] === "-" || text[0] === "+") index = 1;
  let digits = 0;
  let separators = 0;
  for (; index < text.length; index += 1) {
    const char = text[index];
    if (isDigit(char)) digits += 1;
    else if ((char === "," || char === ".") && digits > 0 && separators === 0) separators += 1;
    else return null;
  }
  if (!digits || text.endsWith(",") || text.endsWith(".")) return null;
  const number = Number(text.replace(",", "."));
  return Number.isFinite(number) ? number : null;
}

/** Rundenzeit in Sekunden („1:31.456“, „1:31,456“, „91.456“, „1:02:03.5“) – sonst `null`. Nur zum Vergleichen. */
export function lapSeconds(value) {
  const text = cleanText(value);
  if (!text) return null;
  const parts = text.split(":");
  if (parts.length > 3) return null;
  let total = 0;
  for (let index = 0; index < parts.length; index += 1) {
    const part = parseNumber(parts[index]);
    if (part === null || part < 0 || (index < parts.length - 1 && !Number.isInteger(part))) return null;
    total = total * 60 + part;
  }
  return total;
}

/** Platz wie „1“, „1.“, „1)“ oder „#1“ (1–1000) – sonst `null`. */
export function parsePlace(value) {
  let text = cleanText(value);
  if (text.startsWith("#")) text = text.slice(1);
  if (text.endsWith(".") || text.endsWith(")")) text = text.slice(0, -1);
  if (!text || text.length > 4) return null;
  for (const char of text) if (!isDigit(char)) return null;
  const place = Number(text);
  return place >= 1 && place <= 1000 ? place : null;
}

export function parseMark(value) {
  return MARK_WORDS[cleanText(value).toLowerCase().split(" / ").join("/")] || null;
}

const NO_TIME_CHARS = new Set(["-", ":", ".", ",", "–", "—"]);

/** Platzhalter ohne Zeit („--:--.---“, „--.---“): keine Zeit, kein Abstand, kein Name (#1927). */
export function isNoTime(value) {
  const text = cleanText(value);
  if (!text) return false;
  for (const char of text) if (!NO_TIME_CHARS.has(char)) return false;
  return true;
}

function isRuler(cells) {
  // Trennlinie einer Markdown-Tabelle („|---|:--:|“).
  const joined = cells.join("");
  if (!joined) return false;
  for (const char of joined) if (char !== "-" && char !== ":" && char !== "=" && char !== "+" && char !== " ") return false;
  return true;
}

function isGap(text) {
  // Zeiten und Abstände („1:23.456“, „+5,2“, „+1 Runde“) zählen nicht als Punkte.
  return text.includes(":") || text.startsWith("+");
}

function short(text) {
  return text.length > 80 ? `${text.slice(0, 77)}…` : text;
}

/** Zeilen samt Nummer; ab `maxRows` gefüllten Zeilen ist Schluss (mit Fehler). */
function readLines(text, maxRows, errors) {
  let source = normalizeText(text);
  if (source.length > MAX_PASTE_CHARS) {
    errors.push({ line: null, text: "", message: `Der Text ist zu lang – höchstens ${MAX_PASTE_CHARS.toLocaleString("de-AT")} Zeichen.` });
    source = source.slice(0, MAX_PASTE_CHARS);
  }
  const lines = [];
  let filled = 0;
  const raw = source.split("\n");
  for (let index = 0; index < raw.length; index += 1) {
    const line = raw[index].endsWith("\r") ? raw[index].slice(0, -1) : raw[index];
    if (!cleanText(line)) continue;
    filled += 1;
    if (filled > maxRows) {
      errors.push({ line: index + 1, text: "", message: `Höchstens ${maxRows} Zeilen – ab hier wurde nichts übernommen.` });
      break;
    }
    lines.push({ number: index + 1, text: line });
  }
  return lines;
}

function pickSeparator(lines) {
  for (const [char, format] of SEPARATORS) {
    if (lines.some((line) => line.text.includes(char))) return { char, format };
  }
  return { char: null, format: "lines" };
}

function splitCells(text, separator) {
  const cells = text.split(separator.char).map(cleanText);
  if (separator.format === "pipe") {
    if (cells.length && !cells[0]) cells.shift();
    if (cells.length && !cells[cells.length - 1]) cells.pop();
  }
  return cells;
}

function headerKey(cell, headers, extra = null) {
  let word = cleanText(cell).toLowerCase();
  if (word.endsWith(".") && word.length > 1) word = word.slice(0, -1);
  for (const [key, words] of Object.entries(headers)) if (words.includes(word)) return key;
  return extra ? extra(word) : null;
}

/** Kopfzeile: keine Zahl darin und mindestens ein bekannter Spaltenname – liefert Spalte → Schlüssel. `extra(word)`
 * erkennt weitere Spalten (Runden und Sonderboni eines Turniertags, #1961). */
function readHeader(cells, headers, required, extra = null) {
  if (cells.some((cell) => parseNumber(cell) !== null)) return null;
  const keys = cells.map((cell) => headerKey(cell, headers, extra));
  return keys.includes(required) ? keys : null;
}

/** Runden- und Bonus-Spalten einer Ergebnisliste: `round:N` bzw. `bonus:<Kennung>` (Name des Bonus der Saison). */
function dayColumns(bonuses) {
  const byLabel = new Map((bonuses || []).map((bonus) => [cleanText(bonus.label).toLowerCase(), bonus.key]));
  return (word) => roundHeader(word) || (byLabel.has(word) ? `bonus:${byLabel.get(word)}` : null);
}

// ---------------------------------------------------------------- Ergebnisliste
/** Wörter einer Zeile samt Zahl der Leerzeichen davor (`gap`) – zeichenweise, ohne regulären Ausdruck. */
function tokenize(text) {
  const items = [];
  let current = "";
  let gap = 0;
  let spaces = 0;
  for (const char of normalizeText(text)) {
    if (INVISIBLE.has(char)) continue;
    if (isSpace(char)) {
      if (current) {
        items.push({ text: current, gap });
        current = "";
      }
      spaces += 1;
      continue;
    }
    if (!current) {
      gap = items.length ? spaces : 0;
      spaces = 0;
    }
    current += char;
  }
  if (current) items.push({ text: current, gap });
  return items;
}

// Zeilenformat: eine Zahl am Ende ist nur dann Punkte, wenn sie klar abgesetzt ist – mindestens zwei Leerzeichen davor
// oder eine Einheit dahinter („25 Pkt“, „25 P.“). Sonst gehört sie zum Namen („Max Muster 33“), und die Zeile bekommt
// `points_hint`: die Oberfläche fragt, ob die letzte Zahl Punkte sind.
function lineRow(text) {
  const items = tokenize(text);
  let place = null;
  const first = items[0].text;
  let digits = 0;
  while (digits < first.length && isDigit(first[digits])) digits += 1;
  if (digits > 0 && digits === first.length) {
    place = parsePlace(first);
    if (place !== null) items.shift();
  } else if (digits > 0 && (first[digits] === "." || first[digits] === ")")) {
    place = parsePlace(first.slice(0, digits + 1));
    if (place !== null) {
      const rest = first.slice(digits + 1);
      items.shift();
      if (rest) items.unshift({ text: rest, gap: 1 });
    }
  }
  while (items.length && (items[0].text === "-" || items[0].text === "–" || items[0].text === "|")) items.shift();

  let points = null;
  let hint = null;
  let unit = false;
  const marks = [];
  while (items.length > 1) {
    const last = items[items.length - 1];
    if (isNoTime(last.text)) {
      items.pop();
      continue;
    }
    const mark = parseMark(last.text);
    if (mark) {
      if (!marks.includes(mark)) marks.unshift(mark);
      items.pop();
      continue;
    }
    if (POINT_UNITS.has(last.text.toLowerCase()) && items.length > 2 && parseNumber(items[items.length - 2].text) !== null && points === null) {
      items.pop();
      unit = true;
      continue;
    }
    const number = parseNumber(last.text);
    if (number !== null && points === null && !last.text.startsWith("+")) {
      if (unit || last.gap >= 2) {
        points = number;
        items.pop();
      } else {
        hint = { points: number, text: last.text };
      }
    }
    break;
  }
  return { place, name: items.map((item) => item.text).join(" "), team: "", points, start_number: "", marks, points_hint: hint, grid: null, time: "", gap: "", ...noDay() };
}

function noDay() {
  return { rounds: [], day_points: null, bonus_keys: [] };
}

function cellRow(cells) {
  let place = null;
  let name = "";
  let team = "";
  let startNumber = "";
  let time = "";
  let gap = "";
  const numbers = [];
  const marks = [];
  cells.forEach((cell, index) => {
    if (!cell) return;
    if (index === 0 && parsePlace(cell) !== null) {
      place = parsePlace(cell);
      return;
    }
    const mark = parseMark(cell);
    if (mark) {
      if (!marks.includes(mark)) marks.push(mark);
      return;
    }
    if (isNoTime(cell)) return;
    if (isGap(cell)) {
      // Ohne Kopfzeile: „+…“ ist der Abstand, eine Zelle mit „:“ die Zeit (#1927).
      if (cell.startsWith("+")) gap ||= cell;
      else time ||= cell;
      return;
    }
    const number = parseNumber(cell);
    if (number !== null) {
      if (!name && place !== null && !startNumber) startNumber = cell;
      else if (name) numbers.push(number);
      return;
    }
    if (!name) name = cell;
    else if (!team) team = cell;
  });
  if (place === null && numbers.length && Number.isInteger(numbers[0]) && numbers[0] >= 1 && numbers[0] <= 1000) {
    place = numbers.shift();
  }
  const points = numbers.length ? numbers[numbers.length - 1] : null;
  return { place, name, team, points, start_number: startNumber, marks, points_hint: null, grid: null, time, gap, ...noDay() };
}

function headerRow(cells, keys) {
  const row = { place: null, name: "", team: "", points: null, start_number: "", marks: [], points_hint: null, grid: null, time: "", gap: "", ...noDay() };
  keys.forEach((key, index) => {
    const cell = cells[index] || "";
    if (!cell) return;
    // Turniertag (#1961): Runde N, Sonderbonus. Eine leere oder unlesbare Runde bleibt leer (nicht gespielt).
    if (key && key.startsWith("round:")) {
      const number = Number(key.slice(6));
      while (row.rounds.length < number) row.rounds.push(null);
      row.rounds[number - 1] = parseNumber(cell);
      return;
    }
    if (key && key.startsWith("bonus:")) {
      if (bonusTicked(cell) && !row.bonus_keys.includes(key.slice(6))) row.bonus_keys.push(key.slice(6));
      return;
    }
    // Marken stehen oft in der Zeit- oder Punktespalte („DNF“) – sie zählen in jeder Spalte.
    const mark = key === "name" || key === "team" ? null : parseMark(cell);
    if (mark) {
      if (!row.marks.includes(mark)) row.marks.push(mark);
      return;
    }
    if (!key) return;
    if ((key === "time" || key === "gap" || key === "best_lap") && isNoTime(cell)) return;
    if (key === "place") row.place = parsePlace(cell);
    else if (key === "points") row.points = parseNumber(cell);
    else if (key === "name") row.name = cell;
    else if (key === "team") row.team = cell;
    else if (key === "start_number") row.start_number = cell.slice(0, 10);
    else if (key === "grid") row.grid = parsePlace(cell);
    else if (key === "time") row.time = cell.slice(0, 20);
    else if (key === "gap") row.gap = cell.slice(0, 20);
    else if (key === "best_lap") row.best_lap = cell.slice(0, 20);
    else if (key === "day_points") row.day_points = parseNumber(cell);
  });
  while (row.rounds.length && row.rounds[row.rounds.length - 1] === null) row.rounds.pop();
  return row;
}

/** „Schnellste Runde: Name 1:31.456“ oder „Fahrer des Tages: Name“ – sonst `null`. Trenner zählen als Leerzeichen. */
function raceLine(text) {
  let flat = "";
  for (const char of normalizeText(text)) flat += char === "\t" || char === "|" || char === ";" ? " " : char;
  const line = cleanText(flat);
  const lower = line.toLowerCase();
  for (const [prefix, kind] of RACE_LINES) {
    if (!lower.startsWith(prefix)) continue;
    const rest = line.slice(prefix.length).trimStart();
    if (!rest.startsWith(":")) continue;
    const words = cleanText(rest.slice(1)).split(" ").filter(Boolean);
    if (kind === "driver_of_the_day") return { kind, value: { name: words.join(" ").slice(0, MAX_NAME) } };
    const last = words[words.length - 1] || "";
    const timed = words.length > 1 && lapSeconds(last) !== null && (last.includes(":") || last.includes(".") || last.includes(","));
    return { kind, value: { name: (timed ? words.slice(0, -1) : words).join(" ").slice(0, MAX_NAME), time: timed ? last.slice(0, 20) : "" } };
  }
  return null;
}

/** Die schnellste Runde aus der Spalte „Beste Runde“: die kleinste Zeit. */
function fastestFromColumn(rows) {
  let best = null;
  for (const row of rows) {
    const seconds = lapSeconds(row.best_lap);
    if (seconds !== null && (!best || seconds < best.seconds)) best = { seconds, name: row.name, time: row.best_lap };
  }
  return best ? { name: best.name, time: best.time } : null;
}

/**
 * Ergebnisliste aus der Zwischenablage.
 * Liefert `{format, header, team_column, rows: [{line, place, name, team, points, start_number, marks, points_hint, grid, time, gap}], errors: [{line, text, message}]}`,
 * dazu `fastest_lap` (`{name, time}`) und `driver_of_the_day` (`{name}`), wenn die Liste sie nennt (#1927).
 * `points_hint` (`{points, text}` oder `null`): Zeilenformat mit einer Zahl am Ende, die auch zum Namen gehören kann.
 * `place` und `points` sind `null`, wenn die Liste sie nicht nennt – dann zählt die Reihenfolge bzw. der Schlüssel.
 * Turniertag (#1961): `rounds` (Punkte je Runde, `null` = leer), `day_points` (GES P) und `bonus_keys` - erkannt über die
 * Kopfzeile; `bonuses` sind die Sonderboni der Saison (`{key, label}`), ihre Namen sind Spalten.
 */
export function parseResultPaste(text, { maxRows = MAX_PASTE_ROWS, bonuses = [] } = {}) {
  const errors = [];
  const race = {};
  const lines = readLines(text, maxRows, errors).filter((line) => {
    const found = raceLine(line.text);
    if (found) race[found.kind] = found.value;
    return !found;
  });
  const separator = pickSeparator(lines);
  const rows = [];
  let keys = null;
  lines.forEach((line, position) => {
    let row;
    if (separator.char) {
      const cells = splitCells(line.text, separator);
      if (isRuler(cells)) return;
      if (position === 0 || (position === 1 && !rows.length && !keys)) {
        const header = readHeader(cells, RESULT_HEADERS, "name", dayColumns(bonuses));
        if (header) {
          keys = header;
          return;
        }
      }
      row = keys ? headerRow(cells, keys) : cellRow(cells);
    } else {
      row = lineRow(line.text);
    }
    if (!row.name || parseNumber(row.name) !== null) {
      errors.push({ line: line.number, text: short(cleanText(line.text)), message: NO_NAME });
      return;
    }
    if (row.name.length > MAX_NAME) {
      errors.push({ line: line.number, text: short(row.name), message: `Name zu lang – höchstens ${MAX_NAME} Zeichen.` });
      return;
    }
    rows.push({ line: line.number, ...row, team: row.team.slice(0, MAX_NAME) });
  });
  if (!rows.length && lines.length && errors.every((error) => error.message === NO_NAME)) {
    errors.unshift({ line: null, text: "", message: "Format nicht erkannt. Je Zeile ein Teilnehmer, etwa „1. Name  25“ oder eine Tabelle mit Tab, „|“ oder „;“." });
  }
  const fastest = race.fastest_lap || fastestFromColumn(rows);
  // Hat die Liste eine Team-Spalte (#1960)? Mit Kopfzeile laut Kopf, sonst wenn eine Zeile ein Team nennt. Ohne Spalte
  // belegt das Blatt die Zeilen mit dem Stammteam vor; mit Spalte gilt, was dasteht - leer heißt kein Team.
  const teamColumn = keys ? keys.includes("team") : rows.some((row) => row.team);
  const out = { format: lines.length ? separator.format : null, header: Boolean(keys), team_column: teamColumn, rows: rows.map(({ best_lap: _lap, ...row }) => row), errors };
  if (fastest) out.fastest_lap = fastest;
  if (race.driver_of_the_day) out.driver_of_the_day = race.driver_of_the_day;
  return out;
}

// ---------------------------------------------------------------- Tabelle laut Veranstalter (Team-Liga)
function splitScore(text) {
  const at = text.indexOf(":");
  if (at <= 0) return null;
  const left = parseNumber(text.slice(0, at));
  const right = parseNumber(text.slice(at + 1));
  return left === null || right === null || left < 0 || right < 0 ? null : [left, right];
}

const COUNT_FIELDS = {
  5: ["played", "won", "drawn", "lost", "points"],
  4: ["played", "won", "lost", "points"],
  3: ["played", "won", "points"],
  2: ["played", "points"],
  1: ["points"],
};

function assignCounts(row, numbers) {
  if (numbers.length >= 6) {
    // Sp S U N … Pkt: die Mitte (etwa die Differenz) zählt als Differenz, wenn es genau eine ist.
    const [played, won, drawn, lost] = numbers;
    Object.assign(row, { played, won, drawn, lost, points: numbers[numbers.length - 1] });
    if (numbers.length === 6) row.score_diff = numbers[4];
    return;
  }
  (COUNT_FIELDS[numbers.length] || []).forEach((field, index) => { row[field] = numbers[index]; });
}

function emptyTableRow() {
  return { rank: null, team: "", played: null, won: null, drawn: null, lost: null, score_for: null, score_against: null, score_diff: null, points: null };
}

function tableFromTokens(parts, firstIsRank) {
  const row = emptyTableRow();
  const numbers = [];
  const words = [];
  parts.forEach((part, index) => {
    if (!part) return;
    if (index === 0 && firstIsRank && parsePlace(part) !== null) {
      row.rank = parsePlace(part);
      return;
    }
    const score = splitScore(part);
    if (score) {
      [row.score_for, row.score_against] = score;
      return;
    }
    const number = parseNumber(part);
    if (number !== null && words.length) numbers.push(number);
    else if (number === null) {
      if (numbers.length) return;
      words.push(part);
    }
  });
  row.team = words.join(" ");
  assignCounts(row, numbers);
  return row;
}

function tableHeaderRow(cells, keys) {
  const row = emptyTableRow();
  keys.forEach((key, index) => {
    const cell = cells[index] || "";
    if (!key || !cell) return;
    if (key === "rank") row.rank = parsePlace(cell);
    else if (key === "team") row.team = cell;
    else if (key === "score") {
      const score = splitScore(cell);
      if (score) [row.score_for, row.score_against] = score;
    } else row[key] = parseNumber(cell);
  });
  return row;
}

/** Mehr Zellen als die Kopfzeile (#1931: eine Logo-Spalte, die im Kopf mit dem Team zusammengefasst ist): leere Zellen
 * fallen von links weg, bis es passt. */
function alignCells(cells, length) {
  const out = [...cells];
  while (out.length > length) {
    const empty = out.findIndex((cell) => !cell);
    if (empty < 0) break;
    out.splice(empty, 1);
  }
  return out;
}

/**
 * Tabelle laut Veranstalter (Team-Liga) aus der Zwischenablage: „1. Team 10 7 1 2 22“, „1 | Team | 10 | 22“ oder
 * eine Tabelle mit Kopfzeile („Pl | Team | Sp | S | U | N | Maps | Pkt“). Liefert `{format, header, rows, errors}`.
 */
export function parseTablePaste(text, { maxRows = 100 } = {}) {
  const errors = [];
  const lines = readLines(text, maxRows, errors);
  const separator = pickSeparator(lines);
  const rows = [];
  let keys = null;
  lines.forEach((line, position) => {
    let row;
    if (separator.char) {
      const cells = splitCells(line.text, separator);
      if (isRuler(cells)) return;
      if (position === 0 || (position === 1 && !rows.length && !keys)) {
        const header = readHeader(cells, TABLE_HEADERS, "team");
        if (header) {
          keys = header;
          return;
        }
      }
      row = keys ? tableHeaderRow(alignCells(cells, keys.length), keys) : tableFromTokens(cells, true);
    } else {
      row = tableFromTokens(cleanText(line.text).split(" "), true);
    }
    if (!row.team || parseNumber(row.team) !== null) {
      errors.push({ line: line.number, text: short(cleanText(line.text)), message: NO_TEAM });
      return;
    }
    rows.push({ line: line.number, ...row, team: row.team.slice(0, MAX_NAME) });
  });
  if (!rows.length && lines.length && errors.every((error) => error.message === NO_TEAM)) {
    errors.unshift({ line: null, text: "", message: "Format nicht erkannt. Je Zeile ein Team, etwa „1. Team 10 7 1 2 22“ oder eine Tabelle mit Tab, „|“ oder „;“." });
  }
  return { format: lines.length ? separator.format : null, header: Boolean(keys), rows, errors };
}
