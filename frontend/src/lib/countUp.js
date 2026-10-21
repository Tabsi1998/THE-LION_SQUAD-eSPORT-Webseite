// Hochzählen (#1950, für alle Stellen gedacht, #1969): eine Zeit wie „31:55,056“, ein Abstand wie „+0,261“ oder eine
// Zahl wie „35“ läuft von null auf ihren Wert. Gezählt wird in der Form des Endwerts - gleich viele Stellen, gleiche
// Trennzeichen, gleiches Vorzeichen -, damit die Spalte mit `tabular-nums` ruhig bleibt. Texte mit Wörtern („+2 Runden“,
// „Ausfall“, „DNF“) zählen nicht, sie stehen sofort. Am Ende steht immer genau der Text vom Server.

export const COUNT_UP_MS = 900;
export const COUNT_UP_STAGGER_MS = 25;

const BODY = /^\d+(?::\d{2}){0,2}(?:[.,]\d{1,6})?$/;

/** Die Form eines Werts zum Hochzählen - oder `null`, wenn er nicht zählt (Wörter, leer, nur Null). */
export function countShape(value) {
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

/** Schnell an, weich aus (ease-out, kubisch) - wie die Zeiten auf der Anzeigetafel. */
export function easeOutCubic(t) {
  if (t <= 0) return 0;
  if (t >= 1) return 1;
  return 1 - (1 - t) ** 3;
}

/** Der Text nach `progress` (0 … 1) der Zeit: am Ende genau der Endwert. */
export function countFrame(shape, progress) {
  if (!shape) return "";
  if (progress >= 1) return shape.text;
  return formatShape(shape, Math.round(shape.total * easeOutCubic(progress)));
}
