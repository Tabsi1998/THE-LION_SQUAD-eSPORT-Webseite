// Passwortvertrag (#1033, #1509): dieselben Zahlen wie backend/services/password_policy.py und derselbe Hinweis wie auf
// der Website (frontend/src/lib/passwordRules.js). Der Server entscheidet; die App zeigt nur denselben Satz.

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_BYTES = 72;

export const PASSWORD_RULE_HINT =
  `Mindestens ${MIN_PASSWORD_LENGTH} Zeichen, höchstens ${MAX_PASSWORD_BYTES} Byte (Umlaute zählen doppelt, Emojis vierfach).`;
