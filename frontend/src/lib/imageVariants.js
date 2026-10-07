// Die Breiten, die das Backend vorhält (services/image_variants.py).
// Andere Werte liefert es bewusst nicht aus, damit niemand eine Platte
// vollschreiben kann. 160 und 320 (#1227) sind für Profilbilder, Logos und
// kleine Kacheln - vorher bekam ein 40-Pixel-Bild mindestens die 400er Fassung.
export const VARIANT_WIDTHS = [160, 320, 400, 800, 1600];

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

/**
 * Die Breiten, die für eine Anzeige von `px` Bildpunkten in Frage kommen (#1227): alle bis zur dreifachen
 * Pixeldichte eines Handys und die erste, die sie abdeckt. Ein 40-Pixel-Profilbild bekommt so nur die 160er
 * angeboten, ein 96er die 160er und die 320er - der Browser kann nicht versehentlich eine große nehmen.
 */
export function widthsForDisplay(px, maxDensity = 3) {
  const needed = Math.ceil(Number(px || 0) * maxDensity);
  if (!needed) return VARIANT_WIDTHS;
  const cover = VARIANT_WIDTHS.find((width) => width >= needed);
  const below = VARIANT_WIDTHS.filter((width) => width < needed);
  return cover ? [...below, cover] : below;
}

/**
 * Höchstens bis zur doppelten Bildschirmbreite (#1227): ein Handy mit dreifacher Pixeldichte nähme für ein Foto über
 * die ganze Breite sonst die 1600er Fassung - doppelt so viele Pixel wie nötig für ein scharfes Bild und viermal so
 * viele Bytes. Angeboten werden alle Breiten bis zur ersten, die die doppelte Bildschirmbreite abdeckt.
 */
export function widthsForScreen(widths = VARIANT_WIDTHS, screenWidth = typeof window !== "undefined" ? window.innerWidth : 0) {
  if (!(screenWidth > 0)) return widths;
  const cap = 2 * screenWidth;
  const cover = widths.find((width) => width >= cap);
  return cover ? widths.filter((width) => width <= cover) : widths;
}

/** Die kleinste vorgehaltene Breite, die `devicePx` Gerätepixel abdeckt - sonst die größte. */
export function variantWidthFor(devicePx) {
  return VARIANT_WIDTHS.find((width) => width >= devicePx) || VARIANT_WIDTHS[VARIANT_WIDTHS.length - 1];
}

/** Ein eigener Upload in einer festen Breite (wie `sizedUpload` in der App); andere Adressen bleiben, wie sie sind. */
export function sizedUpload(url, width) {
  const value = String(url || "");
  if (!isResizableUpload(value) || /[?&]w=\d+/.test(value)) return value;
  const [base, hash = ""] = value.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}w=${width}${hash ? `#${hash}` : ""}`;
}
