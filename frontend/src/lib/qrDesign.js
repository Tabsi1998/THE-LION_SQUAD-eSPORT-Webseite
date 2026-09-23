import QRCode from "qrcode";

// QR-Code mit Löwe (#400): ein Modell aus Modulen, Suchmustern, Logo-Platte - gezeichnet als SVG
// auf der Website (BrandedQRCode) und als Datei zum Drucken (qrSvgMarkup). Dieselbe Geometrie an
// allen Stellen; nur die Größe ändert sich. Fehlerkorrektur H, damit die Mitte frei bleiben darf:
// die Platte deckt höchstens 24 % der Kantenlänge (~6 % der Module) - weit unter den 30 %, die H
// verkraftet.

const FINDER = 7;
export const MAX_LOGO_RATIO = 0.24;
export const DEFAULT_VALUE = "https://lionsquad.at";

function round(value) {
  return Math.round(value * 100) / 100;
}

/** Die Modulmatrix: `size` Module je Seite, `dark(x, y)`. */
export function qrMatrix(value, level = "H") {
  const code = QRCode.create(String(value || DEFAULT_VALUE), { errorCorrectionLevel: level });
  const size = code.modules.size;
  const data = code.modules.data;
  return { size, dark: (x, y) => data[y * size + x] === 1 };
}

export function isFinderCell(x, y, size) {
  return (x < FINDER && y < FINDER) || (x >= size - FINDER && y < FINDER) || (x < FINDER && y >= size - FINDER);
}

/**
 * Geometrie in Pixeln für eine Kantenlänge `size`: Ruhezone, Module (ohne Suchmuster und ohne die
 * Fläche unter dem Logo), drei Suchmuster, die Logo-Platte und das Logo selbst.
 */
export function qrModel({ value, size = 116, logoRatio = 0.22, quietZone = 2, fgColor = "#0A0A0A", bgColor = "#ffffff", accent = null, withLogo = true } = {}) {
  const matrix = qrMatrix(value);
  const n = matrix.size;
  const unit = size / (n + quietZone * 2);
  const ratio = withLogo ? Math.min(MAX_LOGO_RATIO, Math.max(0, Number(logoRatio) || 0)) : 0;
  // Die Platte liegt zwischen den Suchmustern; bei kleinen Codes bleibt mindestens eine Modulreihe frei.
  const plateModules = ratio > 0 ? Math.max(0, Math.min(n - 2 * FINDER - 2, Math.round(n * ratio))) : 0;
  const start = Math.floor((n - plateModules) / 2);
  const end = start + plateModules;
  const offset = quietZone * unit;
  const modules = [];
  for (let y = 0; y < n; y += 1) {
    for (let x = 0; x < n; x += 1) {
      if (!matrix.dark(x, y) || isFinderCell(x, y, n)) continue;
      if (plateModules && x >= start && x < end && y >= start && y < end) continue;
      modules.push({ x: round(offset + x * unit), y: round(offset + y * unit) });
    }
  }
  const finderSize = FINDER * unit;
  const finders = [[0, 0], [n - FINDER, 0], [0, n - FINDER]].map(([fx, fy]) => ({ x: round(offset + fx * unit), y: round(offset + fy * unit) }));
  const pad = unit * 0.45;
  const plateSize = plateModules * unit + pad * 2;
  const plateX = offset + start * unit - pad;
  const plate = plateModules ? { x: round(plateX), y: round(plateX), size: round(plateSize), radius: round(unit * 1.2) } : null;
  const logoSize = plate ? plateSize - unit * 0.9 : 0;
  const logo = plate ? { x: round(plateX + (plateSize - logoSize) / 2), y: round(plateX + (plateSize - logoSize) / 2), size: round(logoSize) } : null;
  return {
    size, unit: round(unit), n, quietZone, modules, finders, finderSize: round(finderSize), plate, logo,
    moduleSize: round(unit * 0.92), moduleRadius: round(unit * 0.32), frameRadius: round(size * 0.06),
    colors: { fg: fgColor, bg: bgColor, accent: accent || fgColor },
  };
}

function escape(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

/** Ein Suchmuster: Rahmen in der Akzentfarbe, heller Ring, Kern. */
export function finderParts(model, finder) {
  const s = model.finderSize;
  const u = model.unit;
  return [
    { x: finder.x, y: finder.y, size: s, radius: round(u * 1.6), fill: model.colors.accent },
    { x: round(finder.x + u), y: round(finder.y + u), size: round(s - 2 * u), radius: round(u * 1.1), fill: model.colors.bg },
    { x: round(finder.x + 2 * u), y: round(finder.y + 2 * u), size: round(s - 4 * u), radius: round(u * 0.8), fill: model.colors.accent },
  ];
}

/** Die Datei zum Drucken - dieselbe Geometrie wie auf der Website; das Logo als Adresse oder Daten-URL. */
export function qrSvgMarkup(model, { logoHref = null, title = "QR-Code" } = {}) {
  const { size, colors } = model;
  const parts = [
    `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${escape(title)}">`,
    `<title>${escape(title)}</title>`,
    `<rect width="${size}" height="${size}" rx="${model.frameRadius}" fill="${escape(colors.bg)}"/>`,
    `<g fill="${escape(colors.fg)}">`,
    ...model.modules.map((m) => `<rect x="${m.x}" y="${m.y}" width="${model.moduleSize}" height="${model.moduleSize}" rx="${model.moduleRadius}"/>`),
    "</g>",
    ...model.finders.flatMap((finder) => finderParts(model, finder).map((part) => `<rect x="${part.x}" y="${part.y}" width="${part.size}" height="${part.size}" rx="${part.radius}" fill="${escape(part.fill)}"/>`)),
  ];
  if (model.plate) {
    parts.push(`<rect x="${model.plate.x}" y="${model.plate.y}" width="${model.plate.size}" height="${model.plate.size}" rx="${model.plate.radius}" fill="${escape(colors.bg)}"/>`);
    if (logoHref) parts.push(`<image href="${escape(logoHref)}" xlink:href="${escape(logoHref)}" x="${model.logo.x}" y="${model.logo.y}" width="${model.logo.size}" height="${model.logo.size}" preserveAspectRatio="xMidYMid meet"/>`);
  }
  parts.push("</svg>");
  return parts.join("");
}

export function qrFileName(label, extension) {
  const base = String(label || "qr-code").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/ß/g, "ss").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  return `${base || "qr-code"}.${extension}`;
}
