// Der Nikolausstiefel (Jahreszeiten II S8, X3 #736): ein roter Filzstiefel mit weißem Fellrand, darin Mandarine, Nuss,
// Schokolade und - bis man ihn öffnet - ein Gutschein mit Stern. Am 6. Dezember steht er auf der Linie über dem
// Impressum; ein Klick holt den Sticker heraus, den der Nikolaus der Person bringt (einer je Person und Jahr, der Server
// entscheidet). Reine Form und Regeln; die Anzeige liegt in index.jsx. Die App zeichnet denselben Stiefel
// (mobile/src/seasons/nikolaus/boot.ts) - ein Fingerabdruck in beiden Tests hält die Form gleich.

/** Zeichenfläche: oben Platz für den Inhalt, der aus dem Stiefel schaut. */
export const BOOT_VIEWBOX = { x: 0, y: -8, width: 64, height: 80 };
/** So groß steht der Stiefel auf der Linie (px) - wie die Kürbisse zu Halloween eine kleine, aber greifbare Figur. */
export const BOOT_SIZE = { width: 60, height: 75 };
/** Kleiner als so wird er nicht - ist über der Linie weniger Platz (Handy: Social-Leiste), wird er kleiner. */
export const BOOT_MIN_HEIGHT = 40;
/** Abstand vom rechten Rand: am PC frei vom „Nach oben“-Knopf, auf schmalen Seiten nah am Rand. */
export const BOOT_RIGHT = { wide: 96, narrow: 20 };

/**
 * Wo und wie groß der Stiefel steht: rechts auf der Linie, so hoch, wie über der Linie Platz ist, bevor Schrift,
 * Bild oder Bedienung beginnt (`blockers`: Rechtecke in Seitenkoordinaten, `line`: das Rechteck der Linie).
 */
export function bootFit({ line, blockers = [], viewportWidth = 1280 }) {
  const right = viewportWidth >= 768 ? BOOT_RIGHT.wide : BOOT_RIGHT.narrow;
  if (!line) return { right, height: BOOT_SIZE.height, width: BOOT_SIZE.width };
  const x2 = line.right - right;
  const x1 = x2 - BOOT_SIZE.width;
  const lowest = blockers
    .filter((rect) => rect.width > 0 && rect.height > 0 && rect.bottom <= line.top + 1 && rect.right > x1 && rect.left < x2)
    .reduce((low, rect) => Math.max(low, rect.bottom), -Infinity);
  const free = Number.isFinite(lowest) ? line.top - lowest - 6 : BOOT_SIZE.height;
  const height = Math.round(Math.max(BOOT_MIN_HEIGHT, Math.min(BOOT_SIZE.height, free)));
  return { right, height, width: Math.round((height * BOOT_SIZE.width) / BOOT_SIZE.height) };
}

export const BOOT_COLORS = {
  feltDark: "#9e1b1f",
  felt: "#d4282c",
  feltSide: "#b51e22",
  seam: "#7d1417",
  sole: "#2b1a12",
  fur: "#f6f2ea",
  furBase: "#efe9df",
  furShadow: "#cfc5b6",
  tangerineLight: "#ffb347",
  tangerine: "#f57c00",
  tangerineDark: "#d35400",
  leaf: "#3f9b3a",
  chocolate: "#5a3418",
  chocolateLine: "#3e2310",
  wrapper: "#7b4fa0",
  nut: "#a8743f",
  nutLine: "#7d5229",
  voucher: "#fffaf0",
  voucherEdge: "#e8dcc8",
  star: "#ffc857",
};

export const BOOT_PATHS = {
  shaft: "M 17 15 L 42 15 L 43 43 C 43.5 48 48 50.5 53 52 C 58.5 53.6 62 57.5 61.5 61.5 C 61.2 63.6 60 64.8 57.5 65 L 15 65 C 13.2 65 12.4 64 12.4 62.2 L 12.8 50 C 13 38 14.8 26 17 15 Z",
  sole: "M 12.2 63.4 L 61.4 63.2 C 61.8 66.6 60 68.2 57 68.2 L 15 68.2 C 12.9 68.2 12 67 12.2 63.4 Z",
  seam: "M 15.5 59.5 L 58.5 59.5",
  shine: "M 38.6 19.5 C 39.6 28 39.7 36 39.2 43",
  furShadow: "M 13.5 18.3 Q 30 20.4 46 18.3",
  chocolateLines: "M 32.2 0.5 L 38.3 0.5 M 32.2 3 L 38.3 3",
  star: "M 22.5 -0.5 l 1.1 2.3 2.5 0.3 -1.8 1.7 0.5 2.5 -2.3 -1.2 -2.3 1.2 0.5 -2.5 -1.8 -1.7 2.5 -0.3 z",
  nutLine: "M 37.6 10.2 q 2.4 -1.6 4.8 0",
};

/** Der Fellrand: ein Band und flauschige Bögen darüber (x, y, r). */
export const FUR_BAND = { x: 12.6, y: 12.2, width: 34, height: 6.4, rx: 3 };
export const FUR = [[14.2, 13.4, 4.2], [18.4, 12.6, 4.4], [22.8, 13.3, 4.2], [27.2, 12.5, 4.5], [31.6, 13.2, 4.3], [36, 12.5, 4.4], [40.4, 13.3, 4.2], [44.2, 13, 3.8]];

/** Was aus dem Stiefel schaut. Nach dem Öffnen fehlt der Gutschein, die Mandarine rutscht nach. */
export const TREATS = {
  chocolate: { x: 31, y: -2, width: 8.5, height: 13, rx: 1.2, rotate: 14, cx: 35, cy: 6, wrapperY: 4.5, wrapperHeight: 6.5 },
  voucher: { x: 17, y: -3, width: 11, height: 13, rx: 1.6, rotate: -10, cx: 22, cy: 4 },
  tangerine: { full: { cx: 25.5, cy: 8.6 }, used: { cx: 23, cy: 9.5 }, r: 6 },
  nut: { cx: 40, cy: 10.5, rx: 3.7, ry: 2.9 },
};

/** Ein geöffneter Stiefel steht ruhig und leicht gekippt da - der Gutschein ist draußen (X3: „benutzter Zustand“). */
export const USED_TILT = { angle: -5, cx: 36, cy: 68 };

/** Der Blatt-Pfad der Mandarine an ihrer Stelle. */
export function leafPath({ cx, cy }) {
  return `M ${cx + 0.5} ${cy - 4.8} q 2.6 -2.4 4.6 -0.6 q -2.4 1.6 -4.6 0.6 z`;
}

/** Wie lange der Stiefel wackelt und der Gutschein steigt, bevor die Karte erscheint (ms). */
export const OPEN_MS = 900;
/** So lange bleibt die Karte über dem Stiefel, wenn niemand sie schließt (ms). */
export const CARD_MS = 14000;

/**
 * Was die Karte über dem Stiefel sagt - aus der Antwort des Servers (`result`) oder dem Grund, warum es keine gibt:
 * `guest` (nicht angemeldet), `closed` (der Nikolaus ist gerade nicht da, etwa in der Vorschau), `error` (Netz).
 */
export function cardFor({ result = null, reason = null, greeting = "" } = {}) {
  const title = greeting || "Der Nikolaus war da";
  if (reason === "guest") return { kind: "guest", title, text: "Wer angemeldet ist, findet im Stiefel einen Sticker.", sticker: null };
  if (reason === "closed") return { kind: "closed", title: "Der Nikolaus kommt am 6. Dezember", text: "Dann liegt hier etwas für dich.", sticker: null };
  if (reason === "error" || !result) return { kind: "error", title, text: "Der Stiefel klemmt gerade – versuch es gleich noch einmal.", sticker: null };
  if (!result.sticker) return { kind: "empty", title, text: "Schönen Nikolaustag!", sticker: null };
  const where = `im Chat unter „${result.sticker.pack_name || "Vom Nikolaus"}“`;
  return result.new
    ? { kind: "new", title, text: `Neu in deinen Stickern – ${where}.`, sticker: result.sticker }
    : { kind: "again", title, text: `Den hat dir der Nikolaus heuer gebracht – ${where}.`, sticker: result.sticker };
}
