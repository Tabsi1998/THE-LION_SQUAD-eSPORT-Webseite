// Zusammengesetzte Turniertitel (#1314): „Herbst-LAN • Mario Kart 8 Deluxe • Kleines Turnier | Samstag“ zerlegt in
// Event-Teil (stimmt mit dem Event überein), Tag, Spiel (stimmt mit dem Spiel überein) und den eigentlichen Namen.
// Wo das Event schon dasteht (Turnier unter seinem Event, „gehört zu …“), zeigt die Seite nur den Namen - so passt der
// Titel in zwei Zeilen, statt mit „…“ zu enden. Getrennt wird nur an • | – · mit Leerzeichen davor und danach; ein
// Bindestrich im Wort („Herbst-LAN“) trennt nie. Ohne Regex auf den Titel (Eingabe der Verwaltung).

const SEPARATORS = new Set(["•", "|", "–", "·"]);
const WEEKDAYS = new Set([
  "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag", "sonntag",
  "mo", "di", "mi", "do", "fr", "sa", "so",
]);

function clean(value) {
  return String(value ?? "").split(/\s/).filter(Boolean).join(" ");
}

function textOf(value) {
  if (!value) return "";
  return clean(typeof value === "string" ? value : value.name || value.title || "");
}

function parts(title) {
  const out = [];
  let current = [];
  for (const word of title.split(" ")) {
    if (SEPARATORS.has(word)) {
      if (current.length) out.push(current.join(" "));
      current = [];
    } else {
      current.push(word);
    }
  }
  if (current.length) out.push(current.join(" "));
  return out;
}

const isDigits = (text) => text.length > 0 && [...text].every((char) => char >= "0" && char <= "9");

/** Ein Tag: „Samstag“, „Sa“, „Sa.“, „Tag 2“ oder ein Datum wie „23.05.“. */
function isDay(part) {
  const low = part.toLocaleLowerCase("de");
  if (WEEKDAYS.has(low.endsWith(".") ? low.slice(0, -1) : low)) return true;
  const words = low.split(" ");
  if (words.length === 2 && words[0] === "tag" && isDigits(words[1])) return true;
  const date = low.endsWith(".") ? low.slice(0, -1).split(".") : [];
  return (date.length === 2 || date.length === 3) && date.every((piece) => isDigits(piece) && piece.length <= 4);
}

/**
 * Die Teile eines Turniertitels. `tournament`: das Turnier (`title` oder `name`, dazu `event` und `game` bzw.
 * `game_name`) oder nur der Titel. Ergebnis `{ event, day, game, name }` - fehlende Teile sind leer, `name` ist nie leer,
 * solange der Titel etwas enthält.
 */
export function splitTournamentTitle(tournament) {
  const item = typeof tournament === "string" ? { title: tournament } : tournament || {};
  const title = clean(item.title || item.name || "");
  const eventName = textOf(item.event || item.event_name).toLocaleLowerCase("de");
  const gameName = textOf(item.game || item.game_name).toLocaleLowerCase("de");
  const pieces = parts(title);
  const result = { event: "", day: "", game: "", name: "" };
  const rest = [];
  pieces.forEach((piece, index) => {
    const low = piece.toLocaleLowerCase("de");
    // Der Event-Teil ist oft die Kurzform des Events: „Herbst-LAN 2026“ zu „Herbst-LAN 2026 im Kulturhaus“ - am Anfang
    // des Titels zählt er auch, wenn der Eventname mit ihm beginnt (bis zu einem Leerzeichen, nicht mitten im Wort).
    const eventStart = index === 0 && pieces.length > 1 && eventName.startsWith(`${low} `);
    if (!result.event && eventName && (low === eventName || eventStart)) result.event = piece;
    else if (!result.game && gameName && low === gameName) result.game = piece;
    else if (!result.day && pieces.length > 1 && isDay(piece)) result.day = piece;
    else rest.push(piece);
  });
  result.name = rest.join(" · ") || result.game || result.event || result.day || title;
  return result;
}
