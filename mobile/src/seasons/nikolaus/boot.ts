// Der Nikolausstiefel in der App (X3 #736, S11 #642): derselbe Stiefel wie im Web (frontend/src/seasons/nikolaus/boot.js)
// - roter Filz, weißer Fellrand, Mandarine, Nuss, Schokolade und bis zum Öffnen ein Gutschein mit Stern. Ein
// Fingerabdruck in beiden Tests hält die Form gleich. Reine Form und Texte; die Anzeige liegt in BootSvg.tsx und index.tsx.

export const BOOT_VIEWBOX = { x: 0, y: -8, width: 64, height: 80 };

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

export const FUR_BAND = { x: 12.6, y: 12.2, width: 34, height: 6.4, rx: 3 };
export const FUR: Array<[number, number, number]> = [[14.2, 13.4, 4.2], [18.4, 12.6, 4.4], [22.8, 13.3, 4.2], [27.2, 12.5, 4.5], [31.6, 13.2, 4.3], [36, 12.5, 4.4], [40.4, 13.3, 4.2], [44.2, 13, 3.8]];

export const TREATS = {
  chocolate: { x: 31, y: -2, width: 8.5, height: 13, rx: 1.2, rotate: 14, cx: 35, cy: 6, wrapperY: 4.5, wrapperHeight: 6.5 },
  voucher: { x: 17, y: -3, width: 11, height: 13, rx: 1.6, rotate: -10, cx: 22, cy: 4 },
  tangerine: { full: { cx: 25.5, cy: 8.6 }, used: { cx: 23, cy: 9.5 }, r: 6 },
  nut: { cx: 40, cy: 10.5, rx: 3.7, ry: 2.9 },
};

export const USED_TILT = { angle: -5, cx: 36, cy: 68 };

export function leafPath({ cx, cy }: { cx: number; cy: number }): string {
  return `M ${cx + 0.5} ${cy - 4.8} q 2.6 -2.4 4.6 -0.6 q -2.4 1.6 -4.6 0.6 z`;
}

/** Breite zu einer Höhe - das Seitenverhältnis der Zeichenfläche. */
export function bootWidth(height: number): number {
  return Math.round((height * BOOT_VIEWBOX.width) / BOOT_VIEWBOX.height);
}

/** Wie lange der Stiefel wackelt und der Gutschein steigt, bevor die Karte erscheint (ms) - wie im Web. */
export const OPEN_MS = 900;
export const CARD_MS = 14000;

export type GiftSticker = { id: string; pack_id?: string; pack_name?: string; name: string; url: string; width?: number | null; height?: number | null };
export type OpenResult = { year?: number; new?: boolean; sticker?: GiftSticker | null };
export type BootCard = { kind: "new" | "again" | "empty" | "guest" | "closed" | "error"; title: string; text: string; sticker: GiftSticker | null };

/** Was die Karte sagt - dieselben Sätze wie im Web (`cardFor` in boot.js). */
export function cardFor({ result = null, reason = null, greeting = "" }: { result?: OpenResult | null; reason?: "guest" | "closed" | "error" | null; greeting?: string } = {}): BootCard {
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
