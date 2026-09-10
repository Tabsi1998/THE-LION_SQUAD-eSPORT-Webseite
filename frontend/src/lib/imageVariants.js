// Die Breiten, die das Backend vorhält (services/image_variants.py).
// Andere Werte liefert es bewusst nicht aus, damit niemand eine Platte
// vollschreiben kann.
export const VARIANT_WIDTHS = [400, 800, 1600];

// Nur eigene Uploads lassen sich verkleinern. Ein Bild von einer fremden
// Domain oder ein data:-Bild bleibt, wie es ist.
const LOCAL_UPLOAD = /\/(api\/static\/uploads|static\/uploads|uploads)\//;

export function isResizableUpload(url) {
  const value = String(url || "");
  if (!value || /^(data:|blob:)/i.test(value)) return false;
  if (!LOCAL_UPLOAD.test(value)) return false;
  return /\.(webp|jpe?g|png)(\?|#|$)/i.test(value);
}

/**
 * Ein srcset aus den vorgehaltenen Breiten.
 *
 * Ohne srcset war das sizes-Attribut an den Bildern wirkungslos: der Browser
 * hatte nur eine Fassung zur Auswahl - die gespeicherte, bis zu 4096 Pixel
 * breit. Eine Rasterkachel zeigt davon rund 400.
 */
export function buildSrcSet(url, widths = VARIANT_WIDTHS) {
  if (!isResizableUpload(url)) return undefined;
  const [base, hash = ""] = String(url).split("#");
  const joiner = base.includes("?") ? "&" : "?";
  const entries = widths.map((width) => `${base}${joiner}w=${width}${hash ? `#${hash}` : ""} ${width}w`);
  return entries.length ? entries.join(", ") : undefined;
}
