import { MICRO } from "@/lib/motion";

// Hochzählen (#1950, für alle Stellen, #1969): eine Zeit wie „31:55,056“, ein Abstand wie „+0,261“, eine Zahl wie „35“
// oder eine Zahl als Wert (35, mit eigener Schreibweise wie „1.234“) läuft von null - oder vom alten Wert - auf ihren
// Wert. Text zählt in der Form des Endwerts - gleich viele Stellen, gleiche Trennzeichen, gleiches Vorzeichen -, damit
// die Spalte mit `tabular-nums` ruhig bleibt. Texte mit Wörtern („+2 Runden“, „Ausfall“, „DNF“) zählen nicht, sie
// stehen sofort. Am Ende steht immer genau der Text vom Server.

export const COUNT_UP_MS = MICRO.count;
export const COUNT_UP_STAGGER_MS = MICRO.countStagger;

const BODY = /^\d+(?::\d{2}){0,2}(?:[.,]\d{1,6})?$/;

/** Die Form einer Zahl als Wert: gezählt in ganzen Schritten, geschrieben mit `format` (Vorgabe: wie sie ist). */
function numberShape(value, format) {
  const total = Number(value);
  if (!Number.isFinite(total) || total === 0) return null;
  const write = typeof format === "function" ? format : String;
  return { text: write(total), numeric: true, total, write };
}

/** Die Form eines Werts zum Hochzählen - oder `null`, wenn er nicht zählt (Wörter, leer, nur Null). */
export function countShape(value, format) {
  if (typeof value === "number") return numberShape(value, format);
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
  return { text, sign, separator, widths: parts.map((part) => part.length), fraction: fraction.length, total };
}

/** Der Wert `amount` (in den kleinsten Einheiten der Form) als Text in der Form von `shape`. */
export function formatShape(shape, amount) {
  if (shape.numeric) return shape.write(Math.round(amount));
  const scale = 10 ** shape.fraction;
  const whole = Math.floor(amount / scale);
  const fractionText = shape.fraction ? `${shape.separator}${String(amount % scale).padStart(shape.fraction, "0")}` : "";
  const values = [];
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
export function countStart(shape, from) {
  if (!shape || from === null || from === undefined || from === "") return 0;
  if (shape.numeric) {
    const start = Number(from);
    return Number.isFinite(start) ? start : 0;
  }
  const old = countShape(typeof from === "number" ? String(from) : from);
  if (!old || old.numeric) return 0;
  return Math.max(0, Math.round(old.total * 10 ** (shape.fraction - old.fraction)));
}

/** Schnell an, weich aus (ease-out, kubisch) - wie die Zeiten auf der Anzeigetafel. */
export function easeOutCubic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) ** 3;
}

/** Der Text nach `progress` (0 … 1) der Zeit, vom Start `start` aus: am Ende genau der Endwert. */
export function countFrame(shape, progress, start = 0) {
  if (!shape) return "";
  if (progress >= 1) return shape.text;
  return formatShape(shape, Math.round(start + (shape.total - start) * easeOutCubic(progress)));
}
