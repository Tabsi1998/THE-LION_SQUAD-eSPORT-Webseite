// Wie groß eine Datei sein darf, sagt der Server (#2122): Vorher zeigte das Bildfeld „bis 120 MB“, der Server nahm 50.
// Die Zahlen aus dem Bau gelten nur, solange die Antwort noch aussteht oder ausbleibt.
import { useEffect, useState } from "react";
import { api } from "@/lib/api";

const fromBuild = (value, fallback) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const BUILD_LIMITS = {
  image_mb: fromBuild(import.meta.env.VITE_MAX_IMAGE_UPLOAD_MB, 50),
  video_mb: fromBuild(import.meta.env.VITE_MAX_VIDEO_UPLOAD_MB, 1536),
  document_mb: fromBuild(import.meta.env.VITE_MAX_DOCUMENT_UPLOAD_MB, 50),
  svg_mb: fromBuild(import.meta.env.VITE_MAX_SVG_UPLOAD_MB, 2),
};

let current = BUILD_LIMITS;
let request = null;

export const uploadLimits = () => current;

/** Die Grenzen vom Server, einmal je Seitenaufruf. Scheitert die Abfrage, gelten die aus dem Bau; der nächste Aufruf fragt neu. */
export function loadUploadLimits() {
  if (!request) {
    request = Promise.resolve()
      .then(() => api.get("/uploads/limits"))
      .then((response) => {
        const data = response?.data;
        const known = Object.keys(BUILD_LIMITS).filter((key) => Number(data?.[key]) > 0);
        current = { ...BUILD_LIMITS, ...Object.fromEntries(known.map((key) => [key, Number(data[key])])) };
        return current;
      })
      .catch(() => {
        request = null;
        return current;
      });
  }
  return request;
}

export function useUploadLimits() {
  const [limits, setLimits] = useState(current);
  useEffect(() => {
    let live = true;
    loadUploadLimits().then((next) => { if (live) setLimits(next); });
    return () => { live = false; };
  }, []);
  return limits;
}

export const tooLargeMessage = (mb) => `Die Datei ist zu groß. Erlaubt sind höchstens ${mb} MB. Bitte eine kleinere Datei wählen.`;
