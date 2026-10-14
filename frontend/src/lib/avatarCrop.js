// Profilbild zuschneiden (#1459): reine Rechnung für Zoom und Verschiebung.
//
// Der Zuschnitt ist immer ein Quadrat im Originalbild. Zoom 1 = das größte Quadrat, das ins Bild passt (mittig);
// mehr Zoom = kleineres Quadrat. `offsetX`/`offsetY` verschieben dessen Mitte in Bildpunkten des Originals.
// Zoom und Verschiebung werden so begrenzt, dass das Quadrat nie über das Bild hinausragt: im runden Rahmen gibt es
// nie leere Ränder. Die App schneidet nativ zu (expo-image-picker, `aspect: [1, 1]`), das Ergebnis ist dasselbe.

export const AVATAR_OUTPUT_SIZE = 512;
export const AVATAR_MAX_ZOOM = 4;
export const INITIAL_AVATAR_CROP = Object.freeze({ zoom: 1, offsetX: 0, offsetY: 0 });

/**
 * Sicherheitsprüfung für die Vorschau: nur eine echte Blob-Adresse aus `URL.createObjectURL` darf ins `<img>`.
 * Kein anderes Schema (`javascript:`, `data:`, `https:`), keine Leerzeichen, Anführungszeichen oder spitzen Klammern.
 */
export function isSafeBlobUrl(value) {
  return typeof value === "string" && /^blob:[A-Za-z0-9+.-]+:[^\s"'<>`]+$/.test(value);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function finite(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Zoom auf 1 … Höchstwert, Verschiebung bis an den Bildrand. */
export function clampAvatarCrop(dims, crop) {
  const zoom = clamp(finite(crop?.zoom, 1), 1, AVATAR_MAX_ZOOM);
  const size = Math.min(dims.width, dims.height) / zoom;
  const maxX = (dims.width - size) / 2;
  const maxY = (dims.height - size) / 2;
  return {
    zoom,
    // `+ 0` macht aus -0 eine 0 (sonst stolpern Vergleiche und Anzeigen darüber).
    offsetX: clamp(finite(crop?.offsetX, 0), -maxX, maxX) + 0,
    offsetY: clamp(finite(crop?.offsetY, 0), -maxY, maxY) + 0,
  };
}

/** Das quadratische Quellrechteck im Originalbild (Bildpunkte, nicht gerundet). */
export function avatarSourceRect(dims, crop) {
  const safe = clampAvatarCrop(dims, crop);
  const size = Math.min(dims.width, dims.height) / safe.zoom;
  return {
    x: (dims.width - size) / 2 + safe.offsetX,
    y: (dims.height - size) / 2 + safe.offsetY,
    size,
  };
}

/**
 * Ziehen in der Vorschau: `dx`/`dy` in Bildschirmpunkten, `viewport` = Kantenlänge der runden Ansicht.
 * Wer das Bild nach rechts zieht, sieht mehr vom linken Bildteil.
 */
export function panAvatarCrop(dims, crop, dx, dy, viewport) {
  const safe = clampAvatarCrop(dims, crop);
  const perScreenPixel = Math.min(dims.width, dims.height) / safe.zoom / Math.max(1, viewport);
  return clampAvatarCrop(dims, {
    ...safe,
    offsetX: safe.offsetX - dx * perScreenPixel,
    offsetY: safe.offsetY - dy * perScreenPixel,
  });
}

/** Zoomen um die Mitte des Ausschnitts; danach wieder bis an den Rand begrenzt. */
export function zoomAvatarCrop(dims, crop, zoom) {
  return clampAvatarCrop(dims, { ...crop, zoom });
}

/** Lage des ganzen Bildes in der Vorschau (Bildschirmpunkte), damit genau der Ausschnitt die Ansicht füllt. */
export function avatarPreviewBox(dims, crop, viewport) {
  const rect = avatarSourceRect(dims, crop);
  const scale = viewport / rect.size;
  return {
    left: 0 - rect.x * scale,
    top: 0 - rect.y * scale,
    width: dims.width * scale,
    height: dims.height * scale,
  };
}

/** Kantenlänge der Ausgabe: 512 px, kleinere Ausschnitte werden nicht aufgeblasen. */
export function avatarOutputSize(rect) {
  return Math.max(1, Math.min(AVATAR_OUTPUT_SIZE, Math.round(rect.size)));
}

function canvasToBlob(canvas, type, quality) {
  return new Promise((resolve) => {
    if (typeof canvas.toBlob !== "function") {
      resolve(null);
      return;
    }
    canvas.toBlob(resolve, type, quality);
  });
}

function drawSquare(img, rect, size, background) {
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  if (background) {
    ctx.fillStyle = background;
    ctx.fillRect(0, 0, size, size);
  }
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(img, rect.x, rect.y, rect.size, rect.size, 0, 0, size, size);
  return canvas;
}

/**
 * Schneidet das Bild im Browser quadratisch zu (WebP, sonst JPEG). Über die Canvas gehen auch keine EXIF-Daten mit.
 * Liefert eine Datei für den bestehenden Upload (`/uploads/image`), oder null, wenn der Browser nicht zeichnen kann.
 */
export async function renderAvatarFile(img, dims, crop, fileName = "profilbild") {
  const rect = avatarSourceRect(dims, crop);
  const size = avatarOutputSize(rect);
  const base = String(fileName || "profilbild").replace(/\.[^/.]+$/, "") || "profilbild";
  const canvas = drawSquare(img, rect, size);
  if (!canvas) return null;
  const webp = await canvasToBlob(canvas, "image/webp", 0.9);
  if (webp && webp.type === "image/webp") {
    return new File([webp], `${base}.webp`, { type: "image/webp", lastModified: Date.now() });
  }
  // Browser ohne WebP-Ausgabe: JPEG auf dunklem Grund (JPEG kennt keine Transparenz).
  const flat = drawSquare(img, rect, size, "#0A0A0A");
  const jpeg = flat ? await canvasToBlob(flat, "image/jpeg", 0.9) : null;
  if (!jpeg) return null;
  return new File([jpeg], `${base}.jpg`, { type: "image/jpeg", lastModified: Date.now() });
}
