// Logos als SVG (#1952): Ein hochgeladenes SVG-Logo liegt bereinigt unter /api/static/uploads/<name>.svg, daneben die
// PNG-Fassung mit demselben Namen. Im Web wird das SVG nur über <img> bzw. CSS gezeigt, nie in die Seite geschrieben.
// Was kein SVG kann (Favicon, App-Symbol, Teilen-Bild), nimmt die PNG-Fassung.
const UPLOAD_SVG = /\/api\/static\/uploads\/[A-Za-z0-9][A-Za-z0-9_-]{0,150}\.svg(?=[?#]|$)/i;

export function isSvgUpload(url) {
  return UPLOAD_SVG.test(String(url || ""));
}

export function isSvgFile(file) {
  return (file?.type || "").toLowerCase() === "image/svg+xml" || /\.svg$/i.test(file?.name || "");
}

/** Die PNG-Fassung eines hochgeladenen SVG-Logos - jede andere Adresse bleibt, wie sie ist. */
export function rasterLogoUrl(url) {
  if (!url) return url;
  return String(url).replace(UPLOAD_SVG, (match) => `${match.slice(0, -4)}.png`);
}
