import { micro } from "../theme";

// Hochzählen (#1950, #1974, für alle Stellen #1969) - dieselbe Rechnung wie im Web (frontend/src/lib/countUp.js): eine
// Zeit wie „31:55,056“, ein Abstand wie „+0,261“, eine Zahl wie „35“ oder eine Zahl als Wert (35, auf Wunsch mit
// Tausenderpunkt „1.234“) läuft von null - oder vom alten Wert - auf ihren Wert. Text zählt in der Form des Endwerts:
// gleich viele Stellen, gleiche Trennzeichen, gleiches Vorzeichen, damit die Spalte mit festen Ziffernbreiten ruhig
// bleibt. Texte mit Wörtern („+2 Runden“, „Ausfall“, „DNF“) zählen nicht, sie stehen sofort. Am Ende steht immer genau
// der Text vom Server. Die Zwischenstände rechnet Reanimated auf dem UI-Thread („worklet“).

export const COUNT_UP_MS = micro.count;
export const COUNT_UP_STAGGER_MS = micro.countStagger;
/** Nur die ersten 24 Zeilen zählen hoch - weiter unten steht der Wert gleich da (spart Animationen bei großen Feldern). */
export const COUNT_UP_MAX_ROWS = 24;

const BODY = /^\d+(?::\d{2}){0,2}(?:[.,]\d{1,6})?$/;

export type CountShape = {
  text: string;
  sign: string;
  separator: string;
  widths: number[];
  fraction: number;
  total: number;
  /** Eine Zahl als Wert: gezählt in ganzen Schritten, `grouped` mit Tausenderpunkt. */
  numeric?: boolean;
  grouped?: boolean;
};

export type CountValue = string | number | null | undefined;

/** Ganze Zahlen mit Tausenderpunkt wie auf der ganzen Seite („1.234“), ohne Intl - läuft auch als Worklet. */
export function groupThousands(value: number): string {
  "worklet";
  const rounded = Math.round(Math.abs(value));
  const digits = String(rounded);
  let out = "";
  for (let index = 0; index < digits.length; index += 1) {
    if (index > 0 && (digits.length - index) % 3 === 0) out += ".";
    out += digits[index];
  }
  return value < 0 && rounded ? `-${out}` : out;
}

/** Die Form eines Werts zum Hochzählen - oder `null`, wenn er nicht zählt (Wörter, leer, nur Null). */
export function countShape(value: unknown, grouped = false): CountShape | null {
  if (typeof value === "number") {
    if (!Number.isFinite(value) || value === 0) return null;
    const total = Math.round(value);
    return { text: grouped ? groupThousands(total) : String(total), sign: "", separator: "", widths: [], fraction: 0, total, numeric: true, grouped };
  }
  const text = String(value ?? "").trim();
  if (!text) return null;
  const sign = text[0] === "+" || text[0] === "-" || text[0] === "−" ? text[0] : "";
  const body = text.slice(sign.length);
  if (!BODY.test(body)) return null;
  const separator = body.includes(",") ? "," : body.includes(".") ? "." : "";
  const [whole, fraction = ""] = separator ? body.split(separator) : [body, ""];
  const parts = whole.split(":");
  const scale = 10 ** fraction.length;
  let units = 0;
  for (const part of parts) units = units * 60 + Number(part);
  // Ohne Doppelpunkt ist der ganze Teil keine Uhr: 95,5 Sekunden bleiben 95,5.
  const total = (parts.length > 1 ? units : Number(whole)) * scale + Number(fraction || 0);
  if (!total) return null;
  // Eine Uhr hält ihre Stellen („00:00,000“); eine schlichte Zahl zählt ohne führende Nullen („0“ … „268“, nicht „000“).
  const widths = parts.length > 1 ? parts.map((part) => part.length) : [1];
  return { text, sign, separator, widths, fraction: fraction.length, total };
}

/** Ein Zwischenstand in derselben Form (gleiche Stellen, gleiches Trennzeichen). */
export function formatShape(shape: CountShape, amount: number): string {
  "worklet";
  if (shape.numeric) return shape.grouped ? groupThousands(amount) : String(Math.round(amount));
  const scale = 10 ** shape.fraction;
  const whole = Math.floor(amount / scale);
  const fractionText = shape.fraction ? `${shape.separator}${String(amount % scale).padStart(shape.fraction, "0")}` : "";
  const values: number[] = [];
  let rest = whole;
  for (let index = shape.widths.length - 1; index > 0; index -= 1) {
    values.unshift(rest % 60);
    rest = Math.floor(rest / 60);
  }
  values.unshift(rest);
  const wholeText = values.map((value, index) => String(value).padStart(shape.widths[index], "0")).join(":");
  return `${shape.sign}${wholeText}${fractionText}`;
}

/** Wo das Zählen beginnt (in den Einheiten von `shape`): beim alten Wert `from` - Text oder Zahl -, sonst bei null. */
export function countStart(shape: CountShape | null, from?: CountValue): number {
  if (!shape || from === null || from === undefined || from === "") return 0;
  if (shape.numeric) {
    const start = Number(from);
    return Number.isFinite(start) ? Math.round(start) : 0;
  }
  const old = countShape(typeof from === "number" ? String(from) : from);
  if (!old || old.numeric) return 0;
  return Math.max(0, Math.round(old.total * 10 ** (shape.fraction - old.fraction)));
}

/** Schnell an, weich aus (ease-out, kubisch) - wie die Zeiten auf der Anzeigetafel. */
export function easeOutCubic(t: number): number {
  "worklet";
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) ** 3;
}

/** Der Text bei `progress` (0 bis 1) vom Start `start` aus - am Ende genau der Wert vom Server. */
export function countFrame(shape: CountShape | null, progress: number, start = 0): string {
  "worklet";
  if (!shape) return "";
  if (progress >= 1) return shape.text;
  return formatShape(shape, Math.round(start + (shape.total - start) * easeOutCubic(progress)));
}

/** Versatz je Zeile: 25 ms, höchstens 24 Stufen. */
export function countDelay(index: number): number {
  return Math.min(Math.max(0, index), COUNT_UP_MAX_ROWS) * COUNT_UP_STAGGER_MS;
}

/** Nur die ersten 24 Zeilen zählen hoch. */
export function countsUp(index: number): boolean {
  return index >= 0 && index < COUNT_UP_MAX_ROWS;
}
