// Ein Standbild aus einem Video - im Browser dessen, der es hochlädt.
//
// Auf dem Server ginge das nur mit ffmpeg, also einem zusätzlichen Programm im
// Container. Der Browser hat das Video beim Hochladen ohnehin schon vorliegen;
// dort kostet ein Einzelbild nichts weiter.
//
// Ohne Standbild zeigte eine Videokachel entweder ein graues Filmsymbol oder
// begann von selbst zu spielen, nur um überhaupt ein Bild zu haben.

const POSTER_WIDTH = 800;
const POSTER_QUALITY = 0.72;
// Die erste Sekunde ist oft schwarz oder ein Einblendeffekt.
const DEFAULT_SEEK_SECONDS = 1.0;
// Nach dieser Zeit wird aufgegeben. Ein Browser, der ein Format nicht
// abspielt, meldet das nicht immer - er schweigt einfach.
const TIMEOUT_MS = 12000;

function drawToBlob(video, maxWidth) {
  const ratio = video.videoWidth ? Math.min(1, maxWidth / video.videoWidth) : 1;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(video.videoWidth * ratio));
  canvas.height = Math.max(1, Math.round(video.videoHeight * ratio));
  const context = canvas.getContext("2d");
  if (!context) return Promise.resolve(null);
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/webp", POSTER_QUALITY);
  });
}

/**
 * Liefert ein Standbild als Datei, oder null.
 *
 * Null ist ein zulässiges Ergebnis und kein Fehler: manche Formate lassen sich
 * im Browser nicht abspielen, und ein Video ohne Standbild ist immer noch ein
 * brauchbares Video. Der Upload darf daran nicht scheitern.
 */
export async function captureVideoPoster(file, {
  seek = DEFAULT_SEEK_SECONDS,
  maxWidth = POSTER_WIDTH,
  timeoutMs = TIMEOUT_MS,
} = {}) {
  if (!file || typeof document === "undefined" || typeof URL?.createObjectURL !== "function") return null;

  const objectUrl = URL.createObjectURL(file);
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.preload = "metadata";
  video.crossOrigin = "anonymous";
  video.src = objectUrl;

  try {
    const blob = await new Promise((resolve) => {
      const finish = (value) => {
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => finish(null), timeoutMs);

      video.onerror = () => finish(null);
      video.onloadedmetadata = () => {
        if (!video.videoWidth || !video.videoHeight) return finish(null);
        // Bei sehr kurzen Videos lieber die Mitte als eine Stelle dahinter.
        const target = Number.isFinite(video.duration) && video.duration > 0
          ? Math.min(seek, video.duration / 2)
          : seek;
        video.onseeked = () => drawToBlob(video, maxWidth).then(finish, () => finish(null));
        try {
          video.currentTime = target;
        } catch {
          finish(null);
        }
      };
    });

    if (!blob) return null;
    const base = String(file.name || "video").replace(/\.[^/.]+$/, "");
    return new File([blob], `${base}-vorschau.webp`, { type: "image/webp" });
  } finally {
    video.removeAttribute("src");
    video.load?.();
    URL.revokeObjectURL(objectUrl);
  }
}
