// Lange Titel (#1314): Titel werden nie mit „…“ gekürzt. Sie dürfen zwei Zeilen haben; ist ein Titel länger, kommt er
// eine Schriftstufe kleiner und steht trotzdem ganz da (Umbruch an Wortgrenzen, `.tls-wrap` in index.css). Ab 70 Zeichen
// füllt ein Titel in einer großen Karte am Handy mehr als zwei Zeilen.

export const LONG_TITLE = 70;

export function isLongTitle(title, limit = LONG_TITLE) {
  return String(title || "").trim().length >= limit;
}
