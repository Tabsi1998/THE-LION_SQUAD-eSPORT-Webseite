// Rennzeiten und Abstände (#1981): EINE Schreibweise für die Anzeige, eine fürs Speichern.
//
// - Gespeichert wird wie bisher mit Punkt vor den Nachkommastellen: „1:20.361“, „+0.046“, „+1:34.878“
//   (`normalizeRaceTime` - so liefert es auch die Bild-Erkennung).
// - Angezeigt wird überall wie beim Veranstalter mit Komma: „1:20,361“, „+0,046“, „+1:34,878“ (`formatRaceTime`) -
//   im Ergebnisblatt (Felder, Zusammenfassung, „Aus dem Bild gelesen“) und auf der öffentlichen Serienseite.
// - Eingegeben werden darf beides; alte Daten mit Komma bleiben lesbar.
// Platzhalter wie „--:--.---“ oder „+--:--,---“ heißen „keine Zeit“ (leer); „+1 Runde“, „DNF“ und anderer Text bleiben,
// wie sie sind.

const CLOCK = /^(\+?)(\d{1,3}(?::\d{2}){0,2})[.,](\d{1,3})$/;
const PLACEHOLDER_CHARS = new Set(["-", "–", "—", "_", ":", ".", ",", "+"]);

function compact(value) {
  return String(value ?? "").split(/\s+/).join("");
}

/** Ein Platzhalter statt einer Zeit („--:--.---“, „+--:--,---“) - wie im Server. */
export function isNoRaceTime(value) {
  const key = compact(value);
  if (key.length < 3) return false;
  let dashes = 0;
  for (const char of key) {
    if (!PLACEHOLDER_CHARS.has(char)) return false;
    if (char === "-" || char === "–" || char === "—" || char === "_") dashes += 1;
  }
  return dashes >= 2;
}

function convert(value, separator) {
  const text = String(value ?? "").trim();
  if (!text || isNoRaceTime(text)) return "";
  const match = CLOCK.exec(compact(text));
  if (!match) return text;
  return `${match[1]}${match[2]}${separator}${match[3]}`;
}

/** Zum Anzeigen: Komma vor den Nachkommastellen („1:20.361“ → „1:20,361“). */
export function formatRaceTime(value) {
  return convert(value, ",");
}

/** Zum Speichern: Punkt vor den Nachkommastellen („1:20,361“ → „1:20.361“), Platzhalter → leer. */
export function normalizeRaceTime(value) {
  return convert(value, ".");
}
