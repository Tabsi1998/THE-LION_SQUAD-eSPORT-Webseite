import { qrFileName, qrModel, qrSvgMarkup } from "@/lib/qrDesign";

// Druckversion (#400): SVG für Flyer und Plakate, PNG mit 1024 px für alles andere - dieselbe
// Geometrie wie auf der Website. Das Logo wird für die Datei eingebettet (Daten-URL), damit sie
// ohne Netz und ohne die Website funktioniert.

export const PRINT_SIZE = 1024;

export async function inlineImage(href, fetcher = typeof fetch === "function" ? fetch : null) {
  if (!href || String(href).startsWith("data:") || !fetcher) return href || null;
  try {
    const response = await fetcher(href);
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(typeof reader.result === "string" ? reader.result : null);
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Die SVG-Datei für ein Ziel - mit eingebettetem Logo, wenn es sich laden lässt. */
export async function buildQrSvg({ value, title, logoHref, accent = null, size = PRINT_SIZE, logoRatio = 0.22 }) {
  const model = qrModel({ value, size, logoRatio, accent });
  const inlined = await inlineImage(logoHref);
  return qrSvgMarkup(model, { logoHref: inlined, title });
}

export function downloadBlob(blob, filename, doc = typeof document !== "undefined" ? document : null) {
  if (!doc) return false;
  const url = URL.createObjectURL(blob);
  const link = doc.createElement("a");
  link.href = url;
  link.download = filename;
  doc.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}

export async function downloadQrSvg(options) {
  const markup = await buildQrSvg(options);
  return downloadBlob(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }), qrFileName(options.title, "svg"));
}

/** PNG aus der SVG-Datei: über ein Bild auf eine Leinwand gezeichnet - im Browser, nicht am Server. */
export async function downloadQrPng(options) {
  const markup = await buildQrSvg(options);
  const size = options.size || PRINT_SIZE;
  const svgUrl = URL.createObjectURL(new Blob([markup], { type: "image/svg+xml;charset=utf-8" }));
  try {
    const image = await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error("SVG konnte nicht gezeichnet werden."));
      img.src = svgUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext("2d");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size, size);
    context.drawImage(image, 0, 0, size, size);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (!blob) throw new Error("PNG konnte nicht erzeugt werden.");
    return downloadBlob(blob, qrFileName(options.title, "png"));
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}
