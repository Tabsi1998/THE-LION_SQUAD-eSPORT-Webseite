// Das Vorschau-Token der Saisons (Admin „Vorschau 60 Sekunden“): liegt nur in dieser Sitzung (sessionStorage) und
// gilt bis zu seinem Ablauf. Eigene Datei, damit Bausteine es lesen können, ohne den ganzen Kontext zu laden - und
// Tests, die den Kontext ersetzen, es trotzdem haben.

export const PREVIEW_STORAGE_KEY = "tls-season-preview";

/** Das Vorschau-Token, wenn es gerade für diese Saison gilt - für Abfragen, die die Vorschau kennen (Nikolaus). */
export function previewTokenFor(key, now = Date.now()) {
  const preview = readPreviewToken(now);
  return preview?.token && String(preview.token).split(".")[0] === key ? preview.token : null;
}

export function readPreviewToken(now = Date.now()) {
  try {
    const raw = sessionStorage.getItem(PREVIEW_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.token || !(parsed.expires > now)) {
      sessionStorage.removeItem(PREVIEW_STORAGE_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
