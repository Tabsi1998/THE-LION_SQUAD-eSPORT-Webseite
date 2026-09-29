// Schrift genau messen (H20-Nachbesserung): ein Textbehälter ist oft so breit wie die ganze Karte, seine Buchstaben
// enden aber weit vor der Ecke. Wer nur den Kasten des Elements prüft, sperrt Ecken, die frei sind. Hier liefern
// Ranges die tatsächlichen Zeichenkästen der eigenen Textknoten eines Elements; ohne Layout (Tests, alte Browser)
// gilt der Kasten des Elements.

export const MEDIA_OR_CONTROL = "img, picture, video, svg, canvas, button, input, select, textarea, label, time, [role='img'], [role='button']";
export const TEXT_PAD = 4;

/** Eigene Textknoten (nicht die der Kinder) mit Inhalt. */
export function ownTextNodes(node) {
  return Array.from(node.childNodes || []).filter((child) => child.nodeType === 3 && child.textContent.trim().length > 0);
}

/** Zeichenkästen (Fensterkoordinaten) der eigenen Textknoten - leer, wenn das Element keinen eigenen Text hat; null ohne Layout. */
export function textRects(node, doc = node.ownerDocument || document) {
  const nodes = ownTextNodes(node);
  if (!nodes.length) return [];
  if (!doc || typeof doc.createRange !== "function") return null;
  const rects = [];
  for (const text of nodes) {
    const range = doc.createRange();
    range.selectNodeContents(text);
    if (typeof range.getClientRects !== "function") return null;
    const list = range.getClientRects();
    for (let i = 0; i < list.length; i += 1) {
      const rect = list[i];
      if (rect.width > 0 && rect.height > 0) rects.push(rect);
    }
  }
  return rects;
}

/**
 * Liegt der Fensterpunkt auf Schrift dieses Elements? Ohne messbare Kästen zählt der Kasten des Elements (vorsichtig),
 * ohne eigenen Text nie.
 */
export function pointOnText(node, x, y, pad = TEXT_PAD) {
  const rects = textRects(node);
  if (rects === null) return true;
  return rects.some((rect) => x >= rect.left - pad && x <= rect.right + pad && y >= rect.top - pad && y <= rect.bottom + pad);
}

/**
 * Sperrt das Element den Punkt? Bilder, Grafiken und Bedienelemente mit ihrem Kasten, Text nur mit seinen Zeichen.
 * `link` = ob Links (mit Text) als Bedienelement gelten.
 */
export function blocksPoint(node, x, y, { pad = TEXT_PAD } = {}) {
  if (!node || node.nodeType !== 1 || typeof node.matches !== "function") return false;
  if (node.matches(MEDIA_OR_CONTROL)) return true;
  if (node.matches("a[href]") && ownTextNodes(node).length) return pointOnText(node, x, y, pad);
  return ownTextNodes(node).length ? pointOnText(node, x, y, pad) : false;
}
