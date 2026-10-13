// Passwortvertrag (#1033): dieselben Regeln wie backend/services/password_policy.py.
// Das Backend entscheidet; hier stehen sie nur, damit das Formular früh und mit demselben Text meldet.
// - Unicode wird nach NFC vereinheitlicht, gezählt werden Zeichen (nicht UTF-16-Bausteine).
// - Leerzeichen bleiben, wie sie sind; nichts wird abgeschnitten.
// - mindestens 10 Zeichen, höchstens 72 Byte in UTF-8, keine Steuerzeichen, nicht nur Leerzeichen.

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_BYTES = 72;

export const PASSWORD_RULE_HINT =
  `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen, höchstens ${MAX_PASSWORD_BYTES} Byte (Umlaute zählen doppelt, Emojis vierfach).`;

const MESSAGE_CONTROL = "Das Passwort darf keine Steuerzeichen wie Tabulator oder Zeilenumbruch enthalten.";
const MESSAGE_BLANK = "Das Passwort darf nicht nur aus Leerzeichen bestehen.";
export const MESSAGE_TOO_SHORT = `Das Passwort braucht mindestens ${MIN_PASSWORD_LENGTH} Zeichen.`;
const MESSAGE_TOO_LONG =
  `Das Passwort ist zu lang: höchstens ${MAX_PASSWORD_BYTES} Byte. Umlaute zählen doppelt, Emojis vierfach.`;

const CONTROL_OR_LONE_SURROGATE = /[\p{Cc}\p{Cs}]/u;

export function normalizePassword(value) {
  return String(value ?? "").normalize("NFC");
}

export function passwordLength(value) {
  return [...normalizePassword(value)].length;
}

export function passwordBytes(value) {
  return new TextEncoder().encode(normalizePassword(value)).length;
}

// Warum der Wert als neues Passwort nicht geht - oder null, wenn er passt.
export function passwordProblem(value) {
  const normalized = normalizePassword(value);
  if (CONTROL_OR_LONE_SURROGATE.test(normalized)) return MESSAGE_CONTROL;
  if (normalized && !normalized.trim()) return MESSAGE_BLANK;
  if (passwordLength(normalized) < MIN_PASSWORD_LENGTH) return MESSAGE_TOO_SHORT;
  if (passwordBytes(normalized) > MAX_PASSWORD_BYTES) return MESSAGE_TOO_LONG;
  return null;
}
