// Lesbar aus 5 Metern (#1111): alle Größen der TV-Seiten an einer Stelle. Gerechnet wird in „Einheiten“: eine
// Einheit ist 1 % der Bildhöhe (bei sehr schmalen Bildschirmen etwas weniger, damit nichts aus dem Bild läuft).
// Untergrenzen: Namen 2 % der Bildhöhe (22 px bei Full HD), Nebensachen 1,4 % (15 px); „Groß“ hebt beide um die
// Hälfte an. Zahlen, Zeiten und Stationen sind eher größer. TvScreen setzt die Werte als CSS-Variablen
// (components/tv/tv.css nimmt sie mit clamp()), und dieselben Zahlen rechnen hier aus, wie viel auf eine Seite passt.

export const TV_LIMITS = Object.freeze({
  normal: Object.freeze({ name: 2, other: 1.4 }),
  large: Object.freeze({ name: 3, other: 2.1 }),
});

// Schriftgrößen in Einheiten. meta = Nebensachen (Status, Hinweise), info = Zeiten und Stationen, name = Namen
// (nameMin für lange Namen), num = Ergebnisse und Zähler, head = Rundentitel, title = Seitentitel, hero = große Zeiten.
export const TV_SCALES = Object.freeze({
  normal: Object.freeze({ meta: 1.4, info: 1.75, name: 2.3, nameMin: 2, num: 2.7, head: 2.5, title: 4.2, hero: 6 }),
  large: Object.freeze({ meta: 2.1, info: 2.5, name: 3.3, nameMin: 3, num: 3.8, head: 3.2, title: 5, hero: 7 }),
});

// Abstände und Kästen in Einheiten - je Schriftgröße, damit „Groß“ nicht gequetscht aussieht.
export const TV_BOXES = Object.freeze({
  normal: Object.freeze({ avatar: 3.4, padX: 1, padY: 0.55, rowPadY: 0.5, gap: 0.8, colPad: 0.7, colMin: 36, qr: 9.5 }),
  large: Object.freeze({ avatar: 4.4, padX: 1.2, padY: 0.7, rowPadY: 0.6, gap: 1, colPad: 0.9, colMin: 46, qr: 11 }),
});

export const TV_LINE = Object.freeze({ meta: 1.25, info: 1.25, name: 1.12, num: 1, head: 1.1, title: 1.05, hero: 1 });
// Durchschnittliche Zeichenbreite in em - eher großzügig, die Ersatzschriften sind breiter als Outfit. Liegt die
// Rechnung doch einmal daneben, merkt das der Turnierbaum-TV (eine Spalte läuft über) und rechnet mit Zuschlag neu.
export const CHAR_EM = 0.5;
// Rahmen und Rundungsreste je Karte.
const CARD_BORDER = 0.35;

export function tvScale(textSize) {
  return TV_SCALES[textSize === "large" ? "large" : "normal"];
}

export function tvBox(textSize) {
  return TV_BOXES[textSize === "large" ? "large" : "normal"];
}

/** Die CSS-Variablen für eine Schriftgröße - TvScreen setzt sie am Bildschirm, tv.css rechnet damit. */
export function tvCssVars(textSize) {
  const scale = tvScale(textSize);
  const box = tvBox(textSize);
  const vars = {};
  for (const [name, value] of Object.entries(scale)) vars[`--tv-k-${name}`] = String(value);
  for (const [name, value] of Object.entries(box)) vars[`--tv-b-${name}`] = String(value);
  for (const [name, value] of Object.entries(TV_LINE)) vars[`--tv-lh-${name}`] = String(value);
  return vars;
}

/** Wie viele Pixel eine Einheit bei dieser Bildschirmgröße hat (wie --tv-u in tv.css). */
export function tvUnitPx(width, height) {
  return Math.min(height / 100, width * 0.0075);
}

/** Die kleinste erlaubte Schrift in Pixeln: `kind` „name“ oder „other“. */
export function minFontPx(kind, textSize, height) {
  const limits = TV_LIMITS[textSize === "large" ? "large" : "normal"];
  return (kind === "name" ? limits.name : limits.other) * height / 100;
}

export function charsPerLine(widthUnits, fontUnits) {
  return Math.max(4, Math.floor(widthUnits / (fontUnits * CHAR_EM)));
}

/** Zeilen nach Wörtern umbrochen; ein Wort länger als die Zeile bricht mitten drin (wie overflow-wrap: anywhere). */
export function wrapLines(text, perLine) {
  const words = String(text || "").trim().split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  let lines = 1;
  let used = 0;
  for (const word of words) {
    const length = [...word].length;
    if (used === 0) {
      lines += Math.ceil(length / perLine) - 1;
      used = length % perLine || perLine;
    } else if (used + 1 + length <= perLine) {
      used += 1 + length;
    } else {
      lines += Math.ceil(length / perLine);
      used = length % perLine || perLine;
    }
  }
  return lines;
}

/** Lange Namen: erst etwas kleiner (nie unter die Grenze), dann zweizeilig - nie „…“. */
export function nameFit(label, widthUnits, scale) {
  const text = String(label || "");
  if (wrapLines(text, charsPerLine(widthUnits, scale.name)) <= 1) return { size: scale.name, lines: 1, small: false };
  const lines = Math.max(1, wrapLines(text, charsPerLine(widthUnits, scale.nameMin)));
  return { size: scale.nameMin, lines, small: true };
}

/** Wie viele Karten in eine Spalte passen: der Reihe nach, bis die nächste nicht mehr passt - mindestens eine. */
export function chunkByUnits(items, availableUnits, heightOf, gap = 0) {
  const chunks = [];
  let current = [];
  let used = 0;
  for (const item of items) {
    const height = heightOf(item);
    const needed = current.length ? used + gap + height : height;
    if (current.length && needed > availableUnits) {
      chunks.push(current);
      current = [item];
      used = height;
    } else {
      current.push(item);
      used = needed;
    }
  }
  if (current.length) chunks.push(current);
  return chunks;
}

/**
 * Was von einer Liste auf die Fläche passt, ohne abzuschneiden. Passt nicht alles, bleibt Platz für eine Zeile
 * „+ N weitere“ (`moreUnits`). Gibt die gezeigten Einträge und die Zahl der übrigen zurück.
 */
export function fitItems(items, availableUnits, heightOf, gap = 0, moreUnits = 0) {
  const list = items || [];
  const take = (available) => {
    let used = 0;
    let count = 0;
    for (const item of list) {
      const needed = (count ? gap : 0) + heightOf(item);
      if (used + needed > available) break;
      used += needed;
      count += 1;
    }
    return count;
  };
  let count = take(availableUnits);
  if (count < list.length) count = take(availableUnits - moreUnits - gap);
  return { shown: list.slice(0, count), hidden: list.length - count };
}

/** Wie viele gleich hohe Zeilen in eine Fläche passen - mindestens eine. */
export function fitCount(availableUnits, rowUnits, gap = 0) {
  if (!(rowUnits > 0)) return 1;
  return Math.max(1, Math.floor((availableUnits + gap) / (rowUnits + gap)));
}

/**
 * Die Maße einer Turnierbaum-Spalte in Einheiten: wie breit Namen und Fußzeile sein dürfen.
 * `columnUnits` ist die Breite der ganzen Spalte.
 */
export function bracketColumnWidths(columnUnits, textSize) {
  const scale = tvScale(textSize);
  const box = tvBox(textSize);
  const inner = columnUnits - 2 * box.colPad - 2 * box.padX - CARD_BORDER;
  return {
    name: Math.max(8, inner - box.avatar - 2 * box.gap - scale.num * 1.8),
    footer: Math.max(8, inner),
  };
}

/** Kopf einer Turnierbaum-Spalte (Phase und Runde). */
export function bracketColumnHeadUnits(textSize) {
  const scale = tvScale(textSize);
  const box = tvBox(textSize);
  return 2 * box.padY + scale.meta * TV_LINE.meta + scale.head * TV_LINE.head + CARD_BORDER;
}

/** Zeilen einer Fußzeile aus Teilen (Station, Zeit): passen beide nebeneinander, eine Zeile - sonst je Teil eigene. */
export function footerLines(parts, perLine) {
  const list = (Array.isArray(parts) ? parts : [parts]).map((part) => String(part || "").trim()).filter(Boolean);
  if (!list.length) return 0;
  const together = list.reduce((sum, part) => sum + [...part].length, 0) + 3 * (list.length - 1);
  if (together <= perLine) return 1;
  return list.reduce((sum, part) => sum + wrapLines(part, perLine), 0);
}

/**
 * Höhe einer Spielkarte in Einheiten: Kopfzeile, je Platz eine Zeile (Name ein- oder zweizeilig), Fußzeile mit
 * Station und Zeit. `labels` sind die Namen der Plätze, `footer` die Teile der Fußzeile (Station, Zeit).
 */
export function bracketCardUnits({ labels, footer = [] }, widths, textSize) {
  const scale = tvScale(textSize);
  const box = tvBox(textSize);
  const head = 2 * box.padY + scale.meta * TV_LINE.meta;
  const rows = (labels.length ? labels : ["", ""]).reduce((sum, label) => {
    const fit = nameFit(label, widths.name, scale);
    const text = fit.lines * fit.size * TV_LINE.name;
    return sum + 2 * box.rowPadY + Math.max(box.avatar, text, scale.num * TV_LINE.num);
  }, 0);
  const lines = footerLines(footer, charsPerLine(widths.footer, scale.info));
  const foot = lines ? 2 * box.rowPadY + lines * scale.info * TV_LINE.info : 0;
  return head + rows + foot + CARD_BORDER;
}

/** Wie viele Spalten nebeneinander passen, ohne dass eine schmaler als die Mindestbreite wird (1 bis 4). */
export function columnsFor(widthUnits, textSize, max = 4) {
  const box = tvBox(textSize);
  for (let count = max; count > 1; count -= 1) {
    const width = (widthUnits - (count - 1) * box.gap) / count;
    if (width >= box.colMin) return count;
  }
  return 1;
}
