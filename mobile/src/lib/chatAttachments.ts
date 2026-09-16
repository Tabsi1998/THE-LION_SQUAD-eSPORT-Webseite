import { API_BASE_URL } from "../config";
import type { ChatAttachment } from "../types";
import { api, errorMessage } from "./api";
import { registerCacheClearer } from "./cache";

// Bilder und Videos im Chat, auf Seite der App.
//
// Die Anhänge liegen auf dem Server nicht öffentlich. Jeder Abruf braucht die
// Anmeldung - im Web schickt der Browser das Cookie mit, in der App muss jede
// Bild- und Videoquelle den Bearer-Token selbst tragen.

export const MAX_CHAT_ATTACHMENTS = 4;
// Wie der Server (MAX_CHAT_IMAGE_UPLOAD_MB, MAX_CHAT_VIDEO_UPLOAD_MB). Vorher
// prüfen spart das Hochladen von 300 MB, nur um dann abgelehnt zu werden.
export const MAX_CHAT_IMAGE_BYTES = 25 * 1024 * 1024;
export const MAX_CHAT_VIDEO_BYTES = 100 * 1024 * 1024;

export type AttachmentKind = "image" | "video";

export type PickedAsset = {
  uri: string;
  type?: string | null;
  mimeType?: string | null;
  fileName?: string | null;
  fileSize?: number | null;
};

export type ChatAttachmentDraft = {
  localId: string;
  kind: AttachmentKind | "unknown";
  name: string;
  previewUri: string | null;
  status: "uploading" | "ready" | "error";
  error?: string;
  attachment?: ChatAttachment;
};

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/heic", "image/heif"]);
const VIDEO_MIME = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]);
const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "heic", "heif"]);
const VIDEO_EXT = new Set(["mp4", "webm", "mov", "m4v"]);

function extension(name?: string | null) {
  const match = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : "";
}

export function attachmentKindForAsset(asset: PickedAsset): AttachmentKind | null {
  const mime = String(asset.mimeType || "").toLowerCase();
  if (VIDEO_MIME.has(mime)) return "video";
  if (IMAGE_MIME.has(mime)) return "image";
  if (mime) return null; // z. B. image/gif: bekannter Typ, im Chat nicht erlaubt
  const ext = extension(asset.fileName) || extension(asset.uri);
  if (VIDEO_EXT.has(ext)) return "video";
  if (IMAGE_EXT.has(ext)) return "image";
  // Live-Fotos liefern ein Standbild; ohne Typangabe entscheidet die Auswahl.
  if (asset.type === "video") return "video";
  if (asset.type === "image" || asset.type === "livePhoto") return "image";
  return null;
}

export function tooLargeMessage(asset: PickedAsset, kind: AttachmentKind): string | null {
  const size = Number(asset.fileSize || 0);
  if (kind === "image" && size > MAX_CHAT_IMAGE_BYTES) return "Bild ist größer als 25 MB.";
  if (kind === "video" && size > MAX_CHAT_VIDEO_BYTES) return "Video ist größer als 100 MB.";
  return null;
}

/** Der Teil, den FormData in React Native als Datei versteht. */
export function uploadPartForAsset(asset: PickedAsset, kind: AttachmentKind) {
  const fallbackType = kind === "video" ? "video/mp4" : "image/jpeg";
  const type = asset.mimeType || fallbackType;
  const fallbackExt = type.split("/")[1]?.replace("quicktime", "mov").replace("jpeg", "jpg") || (kind === "video" ? "mp4" : "jpg");
  const name = asset.fileName || `${kind === "video" ? "video" : "bild"}.${fallbackExt}`;
  return { uri: asset.uri, name, type };
}

export function readyAttachmentIds(drafts: ChatAttachmentDraft[]) {
  return drafts
    .filter((draft) => draft.status === "ready" && draft.attachment?.id)
    .map((draft) => draft.attachment!.id);
}

/** Senden darf man Text, einen fertigen Anhang oder beides - aber nicht, solange noch hochgeladen wird. */
export function canSendChatMessage(text: string, drafts: ChatAttachmentDraft[]) {
  if (drafts.some((draft) => draft.status === "uploading")) return false;
  return Boolean(text.trim()) || readyAttachmentIds(drafts).length > 0;
}

/** Absolute Adresse eines Anhangs; mit Breite die kleinere Fassung (400, 800, 1600). */
export function attachmentRequestUrl(url: string, width?: number) {
  const absolute = url.startsWith("/") ? `${API_BASE_URL}${url}` : url;
  return width ? `${absolute}${absolute.includes("?") ? "&" : "?"}w=${width}` : absolute;
}

/** Bild- oder Videoquelle mit Anmeldung; mit Breite die kleinere Fassung. */
export function authorizedSource(url: string | null | undefined, token: string | null | undefined, width?: number) {
  if (!url) return null;
  const uri = attachmentRequestUrl(url, width);
  return token ? { uri, headers: { Authorization: `Bearer ${token}` } } : { uri };
}

/**
 * Der HTTP-Status aus der Meldung des Bildladers, falls einer drinsteht.
 * Android (Fresco) meldet „Unexpected HTTP code Response{…, code=404, …}“,
 * iOS „… status code: 404“ - beides ist in der Kachel abgeschnitten und sagt
 * dem Betreiber nichts (#238).
 */
export function httpStatusFromImageError(message: unknown): number | null {
  const text = String(message ?? "");
  const match = /(?:code=|status(?: code)?[=: ]\s*|HTTP(?: code)?\s+)(\d{3})\b/i.exec(text);
  return match ? Number(match[1]) : null;
}

/** Kurz und lesbar: „HTTP 404: Anhang nicht gefunden“ oder die Netzmeldung. */
export function describeAttachmentError(error: unknown): string {
  const status = (error as { response?: { status?: number } } | null)?.response?.status;
  const text = errorMessage(error, "Unbekannter Fehler");
  return status ? `HTTP ${status}: ${text}` : text;
}

const DATA_URI_LIMIT = 24;
const dataUris = new Map<string, string>();

function blobToDataUri(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string" && reader.result) resolve(reader.result);
      else reject(new Error("Bild konnte nicht gelesen werden."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Bild konnte nicht gelesen werden."));
    reader.readAsDataURL(blob);
  });
}

/**
 * Holt einen Anhang über den API-Client statt über den Bildlader: derselbe
 * Weg wie jeder andere Aufruf der App, mit Token-Erneuerung bei 401. Das
 * Ergebnis ist eine data:-Adresse, die <Image> ohne Kopfzeilen anzeigt.
 * Die letzten Bilder bleiben im Speicher, bis das Konto wechselt.
 */
export async function fetchAttachmentDataUri(url: string, width?: number): Promise<string> {
  const target = attachmentRequestUrl(url, width);
  const known = dataUris.get(target);
  if (known) return known;
  const { data } = await api.get<Blob>(target, { responseType: "blob" });
  const uri = await blobToDataUri(data);
  if (dataUris.size >= DATA_URI_LIMIT) {
    const oldest = dataUris.keys().next().value;
    if (oldest !== undefined) dataUris.delete(oldest);
  }
  dataUris.set(target, uri);
  return uri;
}

export function forgetAttachmentData() {
  dataUris.clear();
}

registerCacheClearer(forgetAttachmentData);
