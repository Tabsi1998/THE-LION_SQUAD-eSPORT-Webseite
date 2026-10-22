// Rennzeiten und Abstände in der App (#1981, #1974): angezeigt wie beim Veranstalter und wie im Web
// (frontend/src/lib/raceTime.js) mit Komma vor den Nachkommastellen - „1:20,361“, „+0,046“, „+1:34,878“. Der Server
// speichert mit Punkt; alte Daten mit Komma bleiben lesbar. Platzhalter wie „--:--.---“ heißen „keine Zeit“ (leer);
// „+1 Runde“, „DNF“ und anderer Text bleiben, wie sie sind.

const CLOCK = /^(\+?)(\d{1,3}(?::\d{2}){0,2})[.,](\d{1,3})$/;
const PLACEHOLDER_CHARS = new Set(["-", "–", "—", "_", ":", ".", ",", "+"]);
const DASHES = new Set(["-", "–", "—", "_"]);

function compact(value: unknown): string {
  return String(value ?? "").split(/\s+/).join("");
}

/** Ein Platzhalter statt einer Zeit („--:--.---“, „+--:--,---“) - wie im Server und im Web. */
export function isNoRaceTime(value: unknown): boolean {
  const key = compact(value);
  if (key.length < 3) return false;
  let dashes = 0;
  for (const char of key) {
    if (!PLACEHOLDER_CHARS.has(char)) return false;
    if (DASHES.has(char)) dashes += 1;
  }
  return dashes >= 2;
}

/** Zum Anzeigen: Komma vor den Nachkommastellen („1:20.361“ → „1:20,361“), Platzhalter → leer. */
export function formatRaceTime(value: unknown): string {
  const text = String(value ?? "").trim();
  if (!text || isNoRaceTime(text)) return "";
  const match = CLOCK.exec(compact(text));
  if (!match) return text;
  return `${match[1]}${match[2]},${match[3]}`;
}
