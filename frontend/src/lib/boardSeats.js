// Vorstand (#1252): Eine Stellvertretung wird nicht gesucht - steht niemand drin, erscheint sie gar nicht (Fabian, 08.10.2026).
// Stellvertretungen gibt es auf zwei Wegen: als „Vertretung erlaubt“ an Obmann, Kassier und Schriftführer - oder, wenn
// Dolibarr den Vorstand führt, als eigene Funktion wie „Stellvertretung Kassier:in“ oder „Obmann-Stellvertreter“.
const DEPUTY_WORDS = /(^|[^a-zäöüß])(stellvertret|stv|vize)/i;

/** Ist dieser Posten selbst eine Stellvertretung (Funktion aus Dolibarr oder von Hand angelegt)? */
export function isDeputyPosition(position) {
  if (!position) return false;
  const words = [position.neutral_title, position.title_male, position.title_female, position.code];
  return words.some((word) => DEPUTY_WORDS.test(String(word || "")));
}
