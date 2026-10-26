/**
 * Trennzeichen einer eingefügten Tabelle: Tab, „|“ oder „;“.
 *
 * Gewählt wird das Zeichen, das in den meisten Zeilen steht. Bei Gleichstand gewinnt das, das in jeder Zeile gleich
 * oft vorkommt, danach die Reihenfolge Tab, „|“, „;“. Steht ein Zeichen in weniger als der Hälfte der Zeilen, gilt es
 * nicht als Trennzeichen. So zerlegt ein „|“ im Teamnamen („ABS|x (ABS|)“) weder eine Tabelle mit „;“ noch eine mit
 * Leerzeichen (#2024).
 */
export const PASTE_SEPARATORS = ["\t", "|", ";"];

function better(score, best) {
  for (let index = 0; index < score.length; index += 1) {
    if (score[index] !== best[index]) return score[index] > best[index];
  }
  return false;
}

/** `lines`: `[{text}]` ohne Leerzeilen. Liefert das Zeichen oder `null` (Spalten durch Leerzeichen bzw. eine Zeile je Eintrag). */
export function pickSeparatorChar(lines, chars = PASTE_SEPARATORS) {
  let best = null;
  chars.forEach((char, order) => {
    const used = lines.map((line) => line.text.split(char).length - 1).filter((count) => count > 0);
    if (!used.length || used.length * 2 < lines.length) return;
    const score = [used.length, used.every((count) => count === used[0]) ? 1 : 0, -order];
    if (!best || better(score, best.score)) best = { char, score };
  });
  return best ? best.char : null;
}
