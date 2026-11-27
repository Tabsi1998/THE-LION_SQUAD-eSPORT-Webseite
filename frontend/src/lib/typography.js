// Großbuchstaben nur für Kurzes (#1303): GROSS stehen Etiketten (tls-type-label), Knöpfe, die Bühne (tls-type-hero) und
// Seitentitel bis 18 Zeichen - „Turniere“ wirkt groß, „Online Cup FC 26: Anmeldung offen für alle Mitglieder“ bleibt
// lesbar. Alles andere steht so da, wie es eingetippt wurde. Namen von Personen, Teams und Spielen laufen nie hier durch.

export const SHORT_CAPS_MAX = 18;

const SOFT_HYPHEN = /­/g;
const segmenter = typeof Intl !== "undefined" && typeof Intl.Segmenter === "function"
  ? new Intl.Segmenter("de", { granularity: "grapheme" })
  : null;

function visibleLength(text) {
  const visible = text.replace(SOFT_HYPHEN, "").trim();
  if (!visible) return 0;
  return segmenter ? Array.from(segmenter.segment(visible)).length : Array.from(visible).length;
}

/** Ist der Text kurz genug für Großbuchstaben (1 bis 18 sichtbare Zeichen)? */
export function isShortCaps(text) {
  if (text === null || text === undefined) return false;
  const length = visibleLength(String(text));
  return length > 0 && length <= SHORT_CAPS_MAX;
}

/** Ein Seitentitel: bis 18 Zeichen GROSS (deutsch: „ß“ wird „SS“ wie im Browser), sonst unverändert. */
export function shortCaps(text) {
  if (text === null || text === undefined) return "";
  const value = String(text);
  return isShortCaps(value) ? value.toLocaleUpperCase("de-DE") : value;
}
