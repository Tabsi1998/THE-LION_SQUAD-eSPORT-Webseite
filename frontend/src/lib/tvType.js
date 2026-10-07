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
// Durchschnittliche Zeichenbreite in em - eher großzügig, die Ersatzschriften sind breiter als Outfit.
export const CHAR_EM = 0.5;
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

// ---------------------------------------------------------------- Turnierbaum auf der Bühne (#1115)
// Der Baum liegt auf einer festen Bühne: eine Einheit ist dort immer 10,8 Punkte (1 % von 1080) - so bricht jeder Name
// auf jedem Bildschirm gleich um, und die Kamera rechnet überall gleich. Die Bühne wird dann passend vergrößert oder
// verkleinert. Damit ein ganzer Baum etwas verkleinert stillstehen darf, sind die Größen dort größer als die
// Untergrenze; wie weit verkleinert werden darf, sagt `treeMinZoom`. Lange Namen werden auf der Bühne nicht noch
// kleiner (das Verkleinern übernimmt der Zoom), sondern zweizeilig - nie „…“.

export const TV_STAGE_UNIT_PX = 10.8;

export const TV_TREE_SCALES = Object.freeze({
  normal: Object.freeze({ meta: 1.85, info: 2, name: 2.6, nameMin: 2.6, num: 3, head: 2.6, title: 4.2, hero: 6 }),
  large: Object.freeze({ meta: 2.75, info: 2.8, name: 3.6, nameMin: 3.6, num: 4.2, head: 3.4, title: 5, hero: 7 }),
});

// card = Breite einer Karte, colGap = Platz für die Linien zwischen den Runden, blockGap = Abstand der Blöcke.
export const TV_TREE_BOXES = Object.freeze({
  normal: Object.freeze({ avatar: 3.4, padX: 1, padY: 0.45, rowPadY: 0.35, gap: 1.1, colPad: 0, card: 37, colGap: 6, blockGap: 3.4, qr: 9.5, colMin: 36 }),
  large: Object.freeze({ avatar: 4.4, padX: 1.2, padY: 0.55, rowPadY: 0.45, gap: 1.3, colPad: 0, card: 49, colGap: 7, blockGap: 4, qr: 11, colMin: 46 }),
});

export function treeScale(textSize) {
  return TV_TREE_SCALES[textSize === "large" ? "large" : "normal"];
}

export function treeBox(textSize) {
  return TV_TREE_BOXES[textSize === "large" ? "large" : "normal"];
}

/**
 * Wie weit der Baum höchstens verkleinert werden darf: so weit, dass Namen (auch lange, etwas kleinere) und alle
 * Nebensachen noch die Untergrenze aus #1111 halten.
 */
export function treeMinZoom(textSize) {
  const limits = TV_LIMITS[textSize === "large" ? "large" : "normal"];
  const scale = treeScale(textSize);
  return Math.max(
    limits.name / scale.name,
    limits.name / scale.nameMin,
    ...["meta", "info", "num", "head"].map((kind) => limits.other / scale[kind]),
  );
}

/** Die CSS-Variablen der Bühne: feste Einheit, Baum-Größen. tv.css rechnet daraus dieselben Klassen wie sonst am TV. */
export function treeCssVars(textSize) {
  const vars = { "--tv-u": `${TV_STAGE_UNIT_PX}px` };
  for (const [name, value] of Object.entries(treeScale(textSize))) vars[`--tv-k-${name}`] = String(value);
  for (const [name, value] of Object.entries(treeBox(textSize))) vars[`--tv-b-${name}`] = String(value);
  return vars;
}

/**
 * Wie groß ein Block des Baums ungefähr wird (Einheiten): `rounds` sind die Spiele je Runde. Geschätzt aus den Größen
 * oben - genau misst später der Browser; die Schätzung entscheidet nur, ob Blöcke neben- oder untereinander stehen.
 */
export function treeBlockUnits(rounds, textSize) {
  const scale = treeScale(textSize);
  const box = treeBox(textSize);
  const row = 2 * box.rowPadY + Math.max(box.avatar, scale.name * TV_LINE.name, scale.num * TV_LINE.num);
  // Ein Durchgang mit Ergebnis trägt rechts Platz und Punkte übereinander - die Zeile wird höher.
  const rowWithPoints = 2 * box.rowPadY + Math.max(box.avatar, scale.name * TV_LINE.name, scale.num * TV_LINE.num + scale.meta * TV_LINE.meta);
  const card = (match) => {
    const slots = Math.max(2, (match?.slots || []).length);
    const heat = slots > 2 || String(match?.match_type || "duel") !== "duel";
    const head = 2 * box.padY + scale.meta * TV_LINE.meta * (heat ? 2 : 1);
    const live = ["running", "in_progress", "live"].includes(String(match?.status || "").toLowerCase()) ? 2.4 * box.rowPadY + scale.num * TV_LINE.num : 0;
    const scored = heat && (match?.results || []).length > 0;
    return head + slots * (scored ? rowWithPoints : row) + live + 0.2;
  };
  const columns = rounds.length;
  const tallest = Math.max(0, ...rounds.map((list) => list.reduce((sum, match) => sum + card(match), 0) + Math.max(0, list.length - 1) * box.gap));
  const title = scale.head * TV_LINE.head + 0.9 + scale.meta * TV_LINE.meta + 0.7;
  return { w: columns * box.card + Math.max(0, columns - 1) * box.colGap, h: title + tallest };
}

/** Bildschirm-Punkte je Bühnen-Punkt bei Zoom 1 - auf jedem 16:9-Bildschirm so, dass die Bühne 1080 Punkte hoch wirkt. */
export function stageBase(width, height) {
  return tvUnitPx(width, height) / TV_STAGE_UNIT_PX;
}
