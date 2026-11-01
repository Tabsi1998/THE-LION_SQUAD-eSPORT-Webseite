// Der Benutzername (#2126): dieselbe Regel wie im Server (backend/services/usernames.py). Sie gilt beim Anlegen; ältere
// Konten behalten ihren Namen.
const USERNAME_PATTERN = /^(?=.*[A-Za-z0-9])[A-Za-z0-9_.-]{3,32}$/;

export const USERNAME_RULE_HINT = "3 bis 32 Zeichen: Buchstaben ohne Umlaute, Ziffern und _ . - (keine Leerzeichen), mindestens ein Buchstabe oder eine Ziffer.";

export function usernameProblem(value) {
  const name = String(value || "").trim();
  if (!name) return "Bitte gib einen Benutzernamen ein.";
  return USERNAME_PATTERN.test(name) ? null : `Benutzername: ${USERNAME_RULE_HINT}`;
}
