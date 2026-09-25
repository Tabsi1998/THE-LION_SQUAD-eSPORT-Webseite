// Bilder und Videos im Chat.
//
// Chat-Anhänge liegen nicht im öffentlichen Upload-Ordner. Der Server liefert
// sie über /api/chat-attachments nur an Chat-Teilnehmer aus; der Browser
// schickt dafür dieselbe Anmeldung mit wie bei jedem anderen API-Aufruf.

import { API_BASE } from "@/lib/api";

export const MAX_CHAT_ATTACHMENTS = 4;
// GIF (#239): bleibt beim Server animiert, wie ein Sticker aus der Tastatur der App.
export const CHAT_ATTACHMENT_ACCEPT = "image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm,video/quicktime";

const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);
const VIDEO_TYPES = new Set(["video/mp4", "video/webm", "video/quicktime", "video/x-m4v"]);
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "webp", "gif"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov", "m4v"]);

export function chatAttachmentKind(file) {
  const type = String(file?.type || "").toLowerCase();
  if (IMAGE_TYPES.has(type)) return "image";
  if (VIDEO_TYPES.has(type)) return "video";
  const extension = String(file?.name || "").split(".").pop().toLowerCase();
  if (IMAGE_EXTENSIONS.has(extension)) return "image";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  return null;
}

/** Adresse eines Anhangs; mit Breite die kleinere Fassung (400, 800 oder 1600). */
export function chatAttachmentSrc(url, width) {
  if (!url) return "";
  const base = String(url).startsWith("/") ? `${API_BASE}${url}` : String(url);
  if (!width) return base;
  return `${base}${base.includes("?") ? "&" : "?"}w=${width}`;
}

export function readyAttachmentIds(drafts) {
  return (drafts || []).filter((draft) => draft.status === "ready" && draft.attachment?.id).map((draft) => draft.attachment.id);
}

/** Gesendet werden darf Text, ein fertiger Anhang oder beides - aber nicht, solange noch hochgeladen wird. */
export function canSendChatMessage(text, drafts) {
  const rows = drafts || [];
  if (rows.some((draft) => draft.status === "uploading")) return false;
  return Boolean(String(text || "").trim()) || readyAttachmentIds(rows).length > 0;
}

export function imageFilesFromClipboard(event) {
  const items = Array.from(event?.clipboardData?.items || []);
  return items
    .filter((item) => item.kind === "file" && IMAGE_TYPES.has(String(item.type || "").toLowerCase()))
    .map((item) => item.getAsFile())
    .filter(Boolean);
}
